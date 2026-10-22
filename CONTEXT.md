# EcomTalent Student Platform — Current State

The Next.js + Supabase app behind EcomTalent's 30-day sprint.
For *how we work* see [CLAUDE.md](CLAUDE.md).
For *table dependencies* see [system_contracts.md](system_contracts.md).
For *the product / what each surface does for the user* see
[PLATFORM_OVERVIEW.md](PLATFORM_OVERVIEW.md).

This document is **the live map** of the app. Updated at the moment any
structure changes.

> **The course rebuild lives on branch `world-engine`, and this document
> describes that branch.** `main` holds none of the rebuild: no `/world`
> route, no `lesson-video` or `lesson-watched` route, no migration file
> from v92 on (checked with git on 2026-10-12). The rebuild-engine and
> world-v6-wiring PRDs record `main` as the production branch.
>
> On `world-engine` the app has a second student home, `/world`: a 3D
> map of the rebuilt eight-area course. Where every student lands is
> one build-time value, `NEXT_PUBLIC_STUDENT_HOME` (default
> `/dashboard`). `/world` is open to every student when that home is
> `/world` or `NEXT_PUBLIC_WORLD_LIVE` is `true`, and otherwise only to
> the allowlist, where an unset list admits nobody
> (`src/lib/world/access.ts`). Until the course switch the home stays
> `/dashboard` and the old course stays in `lessons` and `regions`;
> how the switch moves both is under
> [The course switch](#the-course-switch-cutover).
>
> - **Why the rebuild exists, and how it was designed:**
>   `../_admin/memos/sprint_rebuild.md` (the memo),
>   `../_admin/prds/rebuild-engine/` (PRD 1, the engine: the catalog
>   switch, video, watch tracking), `../_admin/prds/world-v6-wiring/`
>   (the PRD that put the v6 map into `/world`),
>   `../_admin/prds/tella-player/` (the PRD that moved lesson video from
>   Bunny Stream to Tella embeds on 2026-10-12, with its measurements of
>   Tella's player and its decisions D1 to D19) and
>   `../_admin/prds/course-catalog/` (the PRD that put the real course
>   into the staging catalog and connected its videos on 2026-10-13,
>   with its calls C1 to C13). Each PRD folder has a
>   `project_log.md`. Where a build stands is recorded in those folders.
> - **Nothing from the Tella build has run on production.** Migration
>   v100 is not applied there, `POST /api/student/lesson-video` has
>   never been called against a database, the lock check has never
>   executed for real (its route file has run only against stand-ins),
>   and the player has met Tella's real player only in the development
>   harness, never through a login. On the code as it stands after decisions D14 to D19,
>   `tella-watch.mjs` ended `PASS 9  FAIL 0  NOT COVERED 5` (run
>   2026-10-12, 23:38 to 23:45).
>   Every Tella statement below comes from the code, the local tests
>   and the PRD's measurements.
> - **Nothing from the course catalog build has run on production
>   either (2026-10-13).** Migration v101 is not applied there, so
>   production's `lessons_next` still holds v94's placeholder seed. The
>   video load has not been pasted, so no course lesson has a video row
>   or a length there. What that build did change is outside the app:
>   21 of the course's 115 lesson videos on Tella were set to "Embed
>   only". The staging catalog and `lesson_videos` entries under
>   Database have the rest.
> - **Nothing from the cutover has run on production either
>   (2026-10-14).** Migrations v103 and v104 are not applied, no Vercel
>   value has changed, and the code is on `world-engine` only
>   (`410e011` to `3678190`). Production has the old course in `lessons`
>   and no `curriculum_reset_at`. The plan is
>   `../_admin/prds/cutover/cutover_prd.md` (its calls C1 to C22 in
>   section 3, the evening's ship order at the end of section 12), the
>   record is `project_log.md` beside it, and the calls made while it
>   was built are in `../_admin/prds/night-2026-10-14/morning_review.md`.
> - **Nothing from the three release builds has run on production
>   either (2026-10-17).** T-078 (the closed doors before the new
>   course), T-079 (the streak counts only real work) and T-080 (the 30%
>   from 9 September, from 1 October since Lovro's preview review of
>   2026-10-19) are merged into `world-engine` at `53cabf5`, local
>   only. T-078 alone is also branch `coming-soon` (`bb9421d`), which
>   Lovro pushes to `main` with `STUDENT_APP_CLOSED=true` set on Vercel
>   first. Lovro's words for all three are in
>   `../_admin/prds/map-review-2026-10-15/backend_readiness.md`,
>   section 7, and the builders' calls in `decisions.md` beside it.
> - **The map's own records:** `world_overnight_log.md` (every decision
>   taken while the map was built, numbered), `world_art_bible_v6.md`
>   (how each place is built, and the frame budgets) and `.impeccable.md`
>   (the student-side design source of truth).
> - **The first prototype map** is still in the tree and mounted by
>   nothing a student can reach: `src/components/world/WorldCanvas.tsx`,
>   `src/lib/world/scene.ts`, `public/world/` and the development page
>   `src/app/dev/world/`. Its generator and notes are in
>   `../_admin/research/world-gen/README.md`.
> - **A dated record from before the rebuild:**
>   [system-docs/open_items_2026-09-22.md](system-docs/open_items_2026-09-22.md).
>   Its first item (the uncommitted streak fix) has since been committed,
>   so check each item before relying on it.

**Kind:** A composite system: an application (the student and team
screens under `src/app`, behind a login) and a service (the scheduled
jobs under `src/app/api/cron` and the webhooks under
`src/app/api/webhooks`). The two ship as one Next.js deployment and
write one Supabase database.

**Proved by:** Only in part. The standard asks an application for a
browser smoke through the real login with a disposable identity plus
live invariants over its views, and a service for tests on every
change, a live probe of the deployed service and its noticer firing on
a forced failure (`../documentation_standard.md`, section 4). What
exists here, checked on 2026-10-07, for the lesson video on
2026-10-12, for the course catalog on 2026-10-13, and for the cutover
on 2026-10-14:

- **Application.** No browser smoke goes through the real login, and no
  disposable identity exists. No invariant runs against live data.
  What exists is narrower. `node world-tests/v6-app.mjs` walks the
  `/world` screens in a real browser on a login-free development
  harness with a pretend student, so it proves those screens and
  nothing about login, the server or `/dashboard`.
  `node world-tests/v6-course.mjs` walks the same harness with the real
  course in place of the generated one, and proves no more than that.
  `npm run test:client` covers the world's pure modules, and since
  2026-10-16 some routes the screens call (`refresh-watch-sync`,
  `mark-action-shipped`, `skip-lesson` and the two discount routes that
  write a request) through their own `POST` on a stand-in database,
  never a real one. The lesson
  player has two browser scripts: `node world-tests/lesson-player-sim.mjs`
  runs the real component against a stand-in player with no network,
  and `node world-tests/tella-watch.mjs` runs it against Tella's real
  player in the same login-free harness. Neither goes through a login,
  the real video route or the real database function. The files in
  `supabase/diagnostics/` are SQL that someone pastes into the Supabase
  SQL editor by hand. All are read-only checks except four:
  `stamp-tella-test-lessons.sql` and `unstamp-tella-test-lessons.sql`
  (the morning kit, under Database), `load-lesson-videos.sql` (the
  video load, in the `lesson_videos` entry under Database; as tracked
  it is a template and refuses to run), and `stamp-test-lesson.sql`,
  which belongs to the Bunny player and is superseded.
- **The cutover (2026-10-14).** The code that judges a student's
  history was proved on the old course by running the old and the new
  modules side by side in `npm run test:client`: `csm-cutover` (14
  students over days 1 to 30, 0 differences), `achievements-cutover`
  (12 students, every title count) and `curriculum-reset`, plus
  `access` for every home and live setting. `npm run test:migrations`
  runs v103, v104 and both undos (sections 23 and 24) twice, on the
  harness and on a database built from `base.sql` and v92 to v101.
  `node world-tests/v6-discount.mjs` and `node world-tests/v6-hud.mjs`
  walk the checkpoint and the corner on the login-free harness. What
  still needs a login, and so waits for the switch evening (the PRD's
  ship order, steps 10 to 12): every admin page after the switch,
  `/admin/cutover`'s real values and its 401 and 403, the admin pages'
  read of `student_last_counted_completion`, a student landing on
  `/world`, the real Playbook page, and the CSM and engagement crons
  against the switched data (their first tick).
- **Service.** `npm run test:migrations` runs migrations v92 to v101 and
  v103 to v109 (no v102 exists) on a local Postgres, among them the heartbeat function, the snapshot
  rebuild, v100's undo, the morning kit, the course catalog (v101) with
  its generator and its undo, the video load, the cutover's two
  migrations with their undos and its two checks, v105 and v106 (the
  backend audit's fixes, 2026-10-16), v107 (the release review,
  2026-10-17) and v108 (the bug hunt, 2026-10-20) with their undos. Since
  2026-10-16 the Whop webhook's handler runs through its own `POST` in
  `npm run test:client` (`whop-webhook`), on a stand-in database, never
  a real one. Four cron routes have a test:
  `node world-tests/lock-check-sim.mjs` runs the lock check's real
  route file against stand-ins for the database, Tella, Discord and the
  clock, and since 2026-10-20 `client-tests/engagement-alerts.test.mjs`
  and `client-tests/cron-failed-reads.test.mjs` run `check-engagement`,
  `check-na-tasks` and `check-csm-tasks` through their own `GET`, with a
  real supabase-js client on a stand-in PostgREST and Discord
  (`client-tests/README.md`). Nothing runs any test automatically on a change (the repo has
  no CI configuration). The lock check's judging rules are also covered
  by `npm run test:client`, and `node world-tests/tella-lock-live.mjs`
  ran them against two real Tella videos; the route itself
  (`check-lesson-videos`) has never run for real. No probe checks the
  deployed crons: `cron_runs` records every invocation and
  `supabase/diagnostics/admin-health.sql` reads it by hand. No noticer
  fires when a cron fails. The lock check is the one job with an alert
  wired in (`postTeamAlert`), and that alert has never been sent to
  Discord.

Every harness and its command is under [Testing](#testing).

## Parts

| Part | Kind | Code lives at | Writes |
|------|------|---------------|--------|
| Student and team screens | application | Pages under `src/app/` (`login`, `auth`, `dashboard`, `world`, `admin`, `journal`) and the request handlers they call under `src/app/api/` (`auth`, `student`, `discounts`, `admin`, `client-event`) | Everything a signed-in person changes. It is the only writer of `student_lesson_watch` (through the `record_lesson_heartbeat` function), `student_quiz_attempts`, `student_region_quiz`, `student_lesson_ratings`, `discount_requests`, `templates`, `stats_saved_views`, `etfb_team_links` and `etfb_seat_decisions`. |
| Scheduled jobs and webhooks | service | `src/app/api/cron/` (seven routes, five of them scheduled in `vercel.json`) and `src/app/api/webhooks/` (`whop`, `adbounty`) | It is the only writer of `disengagement_alerts`, `canceling_snapshots`, `student_dm_log`, `cron_runs` and `student_milestones.bounty_access_claimed_at`. The unscheduled lock check also writes the three lock columns of `lesson_videos`; the rows themselves are put in by a person in the Supabase SQL editor, the course's by the pasted video load. |

Both parts write `students`, `tasks`, `student_lesson_completions`,
`student_milestones` and `sync_runs`, and both call the
`rebuild_daily_snapshots` function that writes
`daily_progress_snapshots`. The one-writer rule of a composite system
does not hold for those tables.
[system_contracts.md](system_contracts.md) names the writers where it
matters.

## What this is

Two surfaces in one Next.js app:

- **Student-facing** — `/dashboard` (the 30-day sprint map: 4 painted
  regions, lessons, action items, streaks, discount window, region
  to-dos) and `/dashboard/playbook` (Map 2: post-sprint hub with 3
  always-on cards, each opening a full HTML article in an iframe —
  v72). On branch `world-engine` there is also `/world`, the map of the
  rebuilt course: for allowlisted students until the course switch,
  and every student's home after it.
- **Team-facing** — `/admin` (Karlo + CSM team): kanban, students,
  templates, discounts, alerts, insights, discord settings.

## Tech Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind v4**
- **Supabase** — Postgres + RLS + Auth + real-time
- **Whop** — OAuth 2.1 + PKCE, membership webhooks, promo codes,
  watch-history sync (direct HTTP, no SDK)
- **GSAP** — map camera animation
- **Framer Motion** — celebrations, overlays
- **three.js** (`three` 0.169): the 3D world map under `/world`. It is
  loaded with a dynamic import, so a phone, which gets the list view,
  never downloads it. Since 2026-10-20 that download starts when the
  world's layout mounts (`WorldPreload`), while the login and the
  student's data are on their way, and the scene's 17 modules start
  with it (`preloadModules` in `scene.ts`; at the latest when the scene
  is made), where they waited for the terrain to be built.
- **Tella**: lesson video for `/world`, played as an embed in an iframe
  on `https://www.tella.tv`. Until 2026-10-12 this branch played it
  through Bunny Stream, which no code uses now.
- **Vercel** — hosting + cron jobs + Analytics. Functions run in Dublin
  (`dub1`), next to the database, except eight Whop-bound routes, each
  pinned to `iad1` by its entry under `functions` in `vercel.json`
  ([Where the functions run](#where-the-functions-run-deploy-regions)).

## Student Surfaces

| Path | What it is |
|------|------------|
| `/login` | Whop OAuth entry. A server page that shows none of the map (2026-10-19, so the map after sign-in is the reveal): the plum ground, one warm light, faint contour lines of a made-up terrain that `src/app/login/contours.ts` draws on the server into the HTML, the logo, the words, the sand button and Team login; `?error=` codes show in `LoginError.tsx`. While `STUDENT_APP_CLOSED=true` (T-078), its layout (`src/app/login/layout.tsx`, a server component) renders the coming-soon page in place of the login page, with no sign-in button, and the tab reads Ecom University ([The closed doors before the new course](#the-closed-doors-before-the-new-course-t-078)). |
| `/auth/callback` + `/auth/complete` | OAuth callback + post-auth landing |
| `/dashboard` | The map (overview + 4 regions). Auto-redirects to `/dashboard/playbook` once the student has completed `PLAYBOOK_UNLOCK_LESSON_ID` (l078, the last R4 watch lesson) unless `?map=1` is passed. On branch `world-engine`, once `NEXT_PUBLIC_STUDENT_HOME` is anything but `/dashboard`, the page renders nothing and forwards to the home (`router.replace`, query string or not), so none of its extras mount: the intro video gate, "Why you're here", the streak and discount celebrations, the discount feedback modal, `?devtest=1` (cutover WI-7, morning review L3). |
| `/dashboard/playbook` | Map 2 hub. The gate is `StudentContext.playbookUnlocked` (`isPlaybookUnlocked` in `src/lib/progress.ts`, cutover WI-8, 2026-10-14), so this page, the old map and the new map's link give one verdict. Open when `student_milestones.playbook_unlocked_at` is set (the switch's stamp for every graduate of the old course); or when the lesson holding `feature_key = 'playbook_unlock'` is done (l078 on the old course; on a course where no lesson holds it, the last counting lesson by order, a8l13 on the new one); or 30 days after `first_paid_at` (else `joined_at`) with done lessons numbering at least 80% of the counting lessons (v75.16, for older customers who passed the action-item phase before our platform existed). On the old course its verdicts are the old gate's (`client-tests/playbook.test.mjs` runs both). Bounty Access (`bounty_access_claimed_at`) is a SEPARATE milestone and does NOT unlock the Playbook. It is not forwarded when the home moves. Nobody is sent away before the student's data has loaded (opened from `/world` the page mounts a fresh provider, which starts empty); a locked student is then sent to `/dashboard?map=1` while the home is `/dashboard`, else to the home, and the back link goes the same way ("Back to the climb", or "Back to the map" once the home moves). |
| `/world` | Branch `world-engine`. Open to every student when the home is `/world` or `NEXT_PUBLIC_WORLD_LIVE` is `true`, else to allowlisted students only. The world map. The layout (`src/app/world/layout.tsx`) wraps the same `StudentGuard`, `StudentProvider` and `MembershipBlockOverlay` as the dashboard, plus `WorldAccessGate` (the allowlist) and `WorldStage`, and outside the guard `WorldPreload` (the map's code downloading early, 2026-10-20). `WorldStage` mounts the map host `WorldMap` once, so the map stays mounted while the address moves between the three routes. The page itself renders nothing. `WorldMap` shows the v6 map (`WorldV6`) with the student's own areas, lesson titles and finished lessons once the catalog has loaded and has exactly eight areas. In every other state it shows one plain card and loads no 3D: loading, "Your course didn't load.", "There are no lessons here yet.", or "The new course isn't switched on here yet." Under 760 px wide, or under 500 px tall on a touch screen (a phone held sideways, since 2026-10-19; a short laptop window keeps the 3D, since 2026-10-20: `NARROW_QUERY` in `WorldV6.tsx`), or when the 3D fails to start, the same component shows a list view; on a machine that cannot draw the 3D it shows still posters from `public/world-v6/posters/`. Since 2026-10-20 so does a map whose WebGL context the browser took away and did not give back within 3 s while the tab was in front (`CONTEXT_LOST_POSTER_MS` in `src/lib/world-v6/scene.ts`), with the notice "This browser can't show the 3D map. Here's the still version." and no "Try 3D anyway"; a context given back later takes the still views off and the 3D draws again. **The corner (2026-10-14, `WorldCorner`):** one pill in the header's row right after the wordmark, the twin of the discount chip at the other end: the streak (a flame, "4 days"), the achievements held ("4/10", a hexagon) as one button that opens the list in the place panel's slot (streak and best, every achievement by tier with the share of students who hold it, "Unbroken" and "Perfectionist" hidden until earned), and Sign out. A new unlock toasts out of the pill for 6.5 s, one at a time, and waits while a lesson page is open and until the map is up (built, its loading screen gone, the tab in front; 2026-10-17). It stays while a place or the checkpoint is open and hides under a lesson page and through the telescope. It replaces the old dashboard's top-left card; the database's emoji icons are not shown. A finished video refetches the student's data (`StudentContext.markWatched`), so the streak moves at once. A day counts only for a lesson finished (watched in full in the app, or on Whop) or an action item done (T-079). The streak shown is 0 once its last counted day is before yesterday (UTC). A student who has the Playbook sees "Playbook" in the pill between the stats and Sign out (`PlaybookLink`, linking to `/dashboard/playbook`); on a phone, while the discount chip is up, the pill then takes the row under the chip. **The discount checkpoint (2026-10-14):** a trail cache between Video Ads II (the Trail Hut) and Static Ads (the Boathouse), whose look follows the student (closed, near, ready, claimed), plus a header chip from day one ("30% off · 11 days left"), a notch on the course bar where Video Ads II ends and a tag on the timeline. Each opens one panel driven by `discountState()` (`src/lib/world/discount.ts`): the deadline (since 2026-10-17 with its hour, in the student's own time zone: `deadlineAt` in `checkpointView.ts`), the videos watched and left, then Apply, which opens the application's questions over the map in the panel's slot (a full sheet on phones; `WorldDiscountForm`, the same active questions, rules and route as the old dashboard's form, `POST /api/discounts/submit-feedback`; with no active question Apply posts `POST /api/discounts/request` at once); once sent the panel says it is in review; then in review, approved, applied or the reason it was not (since 2026-10-17 an application made on the old dashboard before the new course opened says so in its own words, `madeBeforeLaunch`). For a student the offer is closed to (a first payment before 1 October 2026, 9 September until 2026-10-19, no first payment on record, or the deadline passed with no request) the header has no chip, while the timeline's tag, the phone's row and the cache's marker (shown while the camera is near the cache) still show, and each opens the panel, which says why with no Apply (the owner's second Loom, 2026-10-16). The header's chip shows only while the offer is open to the student or their application is in review or approved (`header` in `src/components/world-v6/checkpointView.ts`). With no first payment on record the panel says "Ask the team". The rule itself is under API Routes, Discounts. **The celebrations (2026-10-14, `WorldCelebrations`):** the old dashboard's streak and discount-approved celebrations, with its triggers and browser keys (`src/lib/world/celebrations.ts`), so one already seen on the dashboard is not shown again; since 2026-10-15 the streak's is a short moment on the number in the pill, and it waits while the discount's is due or up. Since 2026-10-17 a new streak after a break gets its moment from its first day (a streak shown as 0 makes the map forget the number it marked; a streak below that number counts as new too), and the approved 30% opens only once the map is up and no lesson page is over it, so its 5 s timer no longer runs out under the loading picture. An approval of an application made on the old dashboard before the new course opened (`madeBeforeLaunch`) gets no celebration on the map: its words promise the 30% on the next renewal, which may not hold, and the panel says where it stands. Since 2026-10-20 the 30%'s moment also plays for an application the team has already applied, with "Your 30% is on your next payment.", but only within 5 days of the application (`approvalOnMap` and `renewalStillAhead` in `celebrations.ts`): the applied state lasts for good, so on a second device or with the browser key gone it would replay after the renewal used the 30%. The checkpoint panel's applied line says "You'll see 30% off on your next renewal." for those 5 days, then "You got your 30%. The team put it on your Whop subscription." **Night on the student's own clock (2026-10-20 night, branch `night/map-night`, a prototype for the owner to judge, not on production; option D of `_admin/prds/map-review-2026-10-15/real_time_light.md`):** after dark on the computer's own clock (rising from 20:00 to 21:00, night until 05:00, gone by 06:00: `NIGHT_HOURS` in `src/lib/world-v6/clock.ts`) the opening and the first six places show a night of their own: each keeps its view, the moonlight comes from where that view's sun lights it, the moon hangs in its sky, the stars are out, and the lanterns and the lit windows are the brightest things. Creative Strategy keeps its own night and the arch its sunrise, so after dark the airship still flies out of the night into the morning. From 10:00 to 20:00 the map is the day map, pixel for pixel (until the morning below, from 06:00). The clock is read at load, every five minutes and on coming back to the tab; a change eases in over 1.5 s while the map is awake and lands in the one frame it wakes while the map sleeps. **The posters follow the same clock (2026-10-21, same branch):** the opening and the first six places have a night twin of their loading poster (`public/world-v6/posters/<id>-night.webp`, 613 KB for the 7, rendered by `world-tests/v6-posters.mjs --tod=night` with the day's camera and settings; Creative Strategy and the arch keep one poster). The page shows the one nearer to what the live map shows: the night set from a night factor of 0.34 (`POSTER_FROM.night` in `clock.ts`, the opening's measured crossing: from 20:23:30 on the clock; until 05:36:30 before the morning, until 05:35:41 since (05:34:51 before the morning's tune pass)). A small script in every page's head (`CLOCK_BOOT`, put there by `src/app/layout.tsx`) reads the address and the clock by `clock.ts`'s own rule and writes `data-world-tod` on `<html>` before the first paint; the stylesheets pick by it the loading card's ground (`world-ui.module.css .groundPoster`), the poster layer's landing poster (`world.module.css .posterLanding`, drawn by the stylesheet behind a blank `<img>` until the page runs, only where the 3D draws) and its blurred 48 px still, so only the file that shows downloads and no day frame paints after dark. `WorldMap` and `WorldV6` write it again as they mount (a visit that came in by a link, where the script ran on another page), and the clock watcher swaps every poster's file, poster mode's and the phone's picture of the student's place included, if the line is crossed with the page open. `<html>` carries `suppressHydrationWarning`: without it React reports the script's attribute as a hydration mismatch on every page. By day every page asks for the same files as before, byte for byte. **The morning on the same clock (2026-10-21, same branch, after the owner saw the night and a throwaway morning probe):** from 05:00 to 06:00 the night fades out onto a morning (the morning factor is 1 under it from 05:00), the morning holds from 06:00 to 09:00 and fades into the day from 09:00 to 10:00 (`MORNING_HOURS` in `clock.ts`, beside `NIGHT_HOURS`; the clock now gives a `ClockLook`, a night factor and a morning factor). The opening and the first six places each take a morning of their own (`MORNING_ROWS`, `MORNING_BASE`, `MORNING_LOOK` and `MORNING_LIGHT` in `light.ts`): the place's own sun where it stands by day, paler and weaker against a cooler fill (softer, lighter shadows), a clear blue top with a pink and peach horizon, a pale lilac haze, a cool white mist lying low in the valleys and on the lake (`LookKey.mist`, drawn by the fog ramp behind its own test, so by day and at night nothing runs), the greens a touch fresher (`MORNING_DEW`, in the grade behind its own test), lighter water, no stars, no moon, no aurora, the lamps out (the windows, the boathouse and the jetty: `MORNING_LAMP_TINT` turns the lamp materials toward unlit glass, the Landing's halos and the lake's lamps go to 0), and the forest's glow softer under a pink dawn sky. The lesson lanterns keep their day look (they show progress), their halos at the night's strength (`LOOK.haloMorningCut` in `progress-world.ts`, by `state.morning`: over the morning's pale sky the forest's floating steps had bloomed brighter than at dusk). Creative Strategy keeps its night and the arch its sunrise, as after dark. The morning posters (`<id>-morning.webp`, 718 KB for the 7 since the haze, rendered at 07:30 by `world-tests/v6-posters.mjs --tod=morning`) sit beside the night ones; the head's script picks day, morning or night (`posterTod`, `POSTER_FROM`: the night over the morning from 0.36, the morning over the day from 0.54 (0.47 before the haze), both the opening's measured crossings: the morning posters from 05:35:41 to 09:28:24 (09:31:13 before the haze)), the stylesheets read `data-world-tod="morning"` as they read the night, and the clock watcher swaps the posters when a line is crossed with the page open. With the morning at 0 the light is the day's and the night's as they were, value for value (`client-tests/morning-clock.test.mjs`), and drawn on the real GPU with the clocks frozen (1691 x 1278, `?p=partial`), the 7 views at 15:00, 20:30 and 23:00 came out byte for byte the pictures at `eab2330` (one 23:00 picture, Base Camp's, differed by 509 scattered pixels on a first pass and matched on a second: the method's own noise). **The morning's tune pass (2026-10-21, same branch, from a critique of the 7 views at 07:30 against the day, the night and the probe the owner liked):** the middle distance had gone pale and grey under the morning's mist and the day's additive fog, so the rows in `MORNING_ROWS` take a thinner mist at the opening and the Landing, less additive fog at the Landing, the Falls, the Gorge and the lake, a warm bounce and less blue lift in the Falls' shade (it read as a moonlit navy) and a warm bounce at the Gorge, a darker rose haze at the Gorge and a rose violet one at the lake, and at the lake darker water and a mist only from 400 units out, so the Mirror Lake is a mirror again; Base Camp's row is untouched. Each row's comment gives its measurements. The posters were rendered again, the dawn's line measured again on the opening (0.38 to 0.36; the morning's stays 0.47), and the 7 views at 15:00, 20:30 and 23:00 came out byte for byte the build's. **The morning haze (2026-10-21 to 22, same branch, three rounds from the owner's note on the 07:30 sheet that the morning differed from the day only by a slightly bluer sky and that haze would read more like a morning, each round judged by two critiques):** the mist is a bank lying in the low ground with a crisp top that rises and falls (`LookKey.mistDepth`, `mistSoft`, `mistWave`; the drift is a 64 by 64 tiling noise read once a pixel, `fwMistNoise`), lit warm toward the sun and a little cooler on the side turned from it (`mistColor`, `mistGlow`, `mistCool`), coming in past what must stay crisp (`mistNear` to `mistFar`), and the air lays more of the haze on the low ground (`air`, `airLift`, `airFall`), so the tree tops and the ridges stand out of it. Both are drawn by the fog ramp's morning branch in `light.ts` (`fwMist`, `fwMistShape`, `fwMistShade`, `fwAir`, behind `fwMist.a > 0`, so by day and at night none of it runs); each row in `MORNING_ROWS` lays its bank by the heights in its own view, and its comment gives its measurements, the last of them as the page shows them with the half shade below. Base Camp's peaks take a rose lilac haze for first light, and the Glowing Forest a low mist at the far trunks' feet. In the morning the page's bottom shade (`world.module.css .shade::after`, the HUD's legibility gradient) is half as strong (`MORNING_SHADE` in `WorldV6.tsx`, by `WorldFrame.morning`, the morning the light shows at the camera; the stylesheet gives the same 0.5 under `data-world-tod="morning"` until the page writes its own), because at full strength it turned every bank low in the frame greige. The dock, the course bar and the chips have their own backgrounds and the opening's Scroll cue keeps its halo; whether to keep it is the owner's call (its commit reverts on its own). By day and at night the shade and the 7 views at 15:00 are as they were, byte for byte. The morning posters were rendered again with the haze (2026-10-22, `world-tests/v6-posters.mjs --tod=morning`, at 07:30): 718 KB for the 7, where they were 845 (the Mirror Lake's file at webp quality 0.74, which keeps it within 15% of its day twin, the rest at the day's 0.8), with the opening's 48 px still in `world.module.css`; the day posters and the night posters are byte for byte as they were. Measured again on the opening, the dawn's line stays 0.36 and the morning's moves from 0.47 to 0.54, since the morning frame now lies further from the day (the opening's mean distance 28.6 levels; the Landing's 29.6 and Base Camp's 29.3, where they were 14.9 and 13.1), so the day posters take over at 09:28:24 where they did at 09:31:13 (`POSTER_FROM` in `clock.ts`, with each place's reading). At the size the owner saw the sheet (420 px wide), the opening, the Landing, Base Camp and the Falls sit 14.7 to 17.4 dE from their day where they sat 8.6 to 10.0 before the haze; the Gorge (21.4) and the Mirror Lake (26.1) were already far from theirs, since their day is a sunset. |
| `/world/[areaId]` | A place's own address. The route (`PlaceRoute`) renders nothing for an area the catalog has: `WorldStage` reads the same address and the map opens that place's panel. For an unknown area it shows "That place isn't on the map." with a link back. Opening or closing a place inside the map changes the address without moving the page scroll, because the page scroll is the map's camera. |
| `/world/[areaId]/[lessonId]` | The lesson page (`LessonScreen`), drawn over the paused map by `WorldStage` (the route itself renders nothing). A lesson opened from the map shows at the click and its address follows once the router has the route (`open()`, `useOptimistic` in the same transition as `router.push`), so the page never waits on the route: under `next dev` every route change is a request to the dev server, and a phone has no hover to prefetch on; when the address lands it names the same lesson, so the page and its player are not put in again (the second Loom's second fix round, 2026-10-17). The page: a back link to the place, an eyebrow (the area's number, the lesson's position in the area, the minutes when the catalog has them), the lesson title, then for a `watch` lesson with a video the player (`LessonPlayer`: Tella's frame, the app's own progress line under it, and under that up to three lines of text: when the video has not loaded, when the video played to its end and the server still does not see the lesson's 95% point, and when the lesson was not counted because too little of it was played), the Milestone box when the lesson has an action item, the lesson's text (its `description`, drawn by `LessonText` from `src/lib/world/lesson-text.ts`: paragraphs, bullet and numbered lists, bold and https links, no HTML) when it has one, and a Next lesson link that is enabled once the lesson is in `completedLessonIds`, or on an action item with a video once its video is watched (`watchedLessonIds`, its hand-in still open; `isPassed` in `map-model.ts`, 2026-10-19), or at once on a lesson the map says can't be finished here (a `watch` lesson with no video, `MapLesson.finishable`; the second Loom, 2026-10-16). A lesson with no video (a `setup` lesson, or a `watch` lesson whose `has_video` is false) gets no player and no video-sized box: the Milestone box, then the text in the video's place; with no text either, a `watch` lesson says "Not recorded yet." on one short line and a `setup` lesson says nothing (2026-10-14). That is decided from the catalog before any request, and once the player is up for a lesson it stays up for it. Escape returns to the place. An unknown area or lesson, or a lesson under another place's address, shows "That lesson isn't here."; its Back goes to the place, or to the map when the course has no such place (2026-10-16). An action item (`requires_action`) ends with its hand-in (`ActionItemBlock`, 2026-10-14): a field for the Discord message link, Save, then a complete button, the link shown and editable once saved, "Completed on <date>." once done. The link rules, and which halves the button writes, are `src/lib/world/action-items.ts`, shared with the old dashboard's form and both routes. A setup action item is finished by the button alone; one with a video needs the button and the video, in either order. Since 2026-10-22 (branch `night/action-done`, not on production; the owner: these "do not need an action ... We just have to be able to click Done") seven of the ten action items (`DONE_ONLY_ACTION_ITEMS` and `isDoneOnly` in `action-items.ts`, the one list) have a hand-in of another kind (`data-hand-in="done"`, the other kind `"link"`): the four of AI Ads + Content (`a6l03`, `a6l10`, `a6l17`, `a6l19`) and, from the owner's answer later that day ("All other ones in statics are for doing and not sending to coaches"), three of Static Ads (`a5l08` The Backbone, `a5l12` Imitation, `a5l22` the Brand Deck). It is one button, Done, with no field, no link and no word of Discord, which calls the same `mark-action-shipped` as the complete button and so makes the same writes; then "Completed on <date>." and nothing else, whatever link the row may hold from before. On `a5l08` and `a5l12`, which have a video, Done is the action half alone, as the complete button is on any video lesson: pressed first, the block says "Action completed on <date>. Watch the video to finish the lesson." and the lesson waits for its video (the 95% rule), "Next lesson" off; watched first, "Next lesson" is lit and Done then finishes it. Done never writes the video's half. `a3l17`, `a3l25` and `a5l23` (the Static Ad Brief, which the coaches review) keep the Discord kind. The lesson page picks the kind by `isDoneOnly(lesson.id)`. |

**Development-only pages for the world** (both return `notFound()`
outside `NODE_ENV === "development"`):

| Path | What it is for |
|------|----------------|
| `/dev/world-v6` | The v6 map alone, on fixture data, with the TUNE panel (lock mode, where the pretend student is, the scroll length of every stretch). No `StudentProvider` and no request to `/api/*`. `node world-tests/v6-ui.mjs checks` drives this page. Pinned to day whatever the hour (`clock.ts`); `?tod=night`, `?tod=clock` or `?hour=23` (also `HH.MM`) show the night, `?tod=morning` or `?hour=07.30` the morning. |
| `/dev/world-app` | The three `/world` routes with a pretend student and no login: the same `WorldStage`, `WorldMap`, `PlaceRoute` and `LessonScreen`, with `FixtureStudentProvider` in place of the auth guard, `StudentProvider` and the access gate. Presets by query string (`?p=p0`, `mid`, `last`, `ooo`, `all`; `?catalog=loading`, `error`, `empty`, `shape`, `course`). With no `DEV_TELLA_*` value set it makes no network request. With them set (see "The world's own settings"), three of its lessons carry a video: two play the two Tella test videos in Tella's real frame and the third points at the id `vid_doesnotexist0000000000`, which no video has. A stand-in for the server (`fixtureTransport.ts`) answers the player's three calls, so the page still makes no request to `/api/student/*`. It answers at once; `?latency=<ms>` (0 to 5000, default 0, any mode, 2026-10-14) makes it give a lesson's address that many ms after it is asked, as the real route would. `node world-tests/v6-app.mjs` and `node world-tests/tella-watch.mjs` drive this page. The mode `?catalog=course` (2026-10-13) draws the real course in place of the generated one: `courseCatalog.ts` builds the rows from the data file `supabase/catalog/course_catalog.json`, and the lengths and which lessons have a video come from `src/app/dev/world-app/course-lengths.fixture.json` (117 lengths since 2026-10-19, when Music Leverage and then Your Editing Software got their videos; no video id). Its presets are `p0`, `mid` (areas 1 to 3 and `a4l01` to `a4l09`) and `all`; any other name is `p0`. Course mode has no lesson text unless `?text=sample` puts the made-up text of `course-sample-text.fixture.json` on `a5l22` and `a5l08`, or, without it, `DEV_COURSE_TEXT_FILE` names a private file whose texts go on the lessons whose title matches (2026-10-14). With the `DEV_TELLA_*` values set, every course lesson that has a video plays test video 1 there, and the stand-in judges it against that clip's length, while cards and panels keep the course's real minutes. The default catalog is unchanged. `node world-tests/v6-course.mjs` drives this mode. In course mode the map passes over the watch lessons with no video, as the app does (`map-model.ts`); on the default catalog "Mark watched (dev)" finishes any lesson, so there it passes none over (`AnyLessonFinishesContext`, 2026-10-16). The pretend student is called Maya Brooks (made up), so the welcome at the map's start reads "Welcome, Maya" (`StudentNameStandInContext`, 2026-10-19). Pinned to day whatever the hour, as `/dev/world-v6` is; `?tod=` and `?hour=` show the night and the morning (`clock.ts`). |

Older development pages for the map's earlier versions are still in
`src/app/dev/` (`world`, `world-v2` to `world-v5`, `world-codex`,
`area`), and `/dev/world-v6/camera` shows the v6 scene with no
interface for the camera render checks.

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
`auth_failed`, `login_busy` (the Whop login's password sign-in failed
twice, half a second apart, with something other than "invalid login
credentials": a rate limit in a login rush, a 5xx or the network; only
that one error creates an account, login-3, 2026-10-20),
`state_invalid`, `missing_params`, `callback_failed`,
`access_denied`, `profile_load_failed`, `app_closed` (the callback
while the student app is closed, T-078; the login's layout shows the
coming-soon page then, so the map entry is a fallback). Details are
prefixed `server:`
or `client:` so the two sides that both emit `session_failed` stay
distinguishable. **Add a map entry in `src/app/login/LoginError.tsx`
(moved out of `page.tsx` 2026-10-19) whenever you add a code** — an unmapped code falls through to a generic sentence
and the branch is lost. Both spinner gates have hard watchdogs
(`auth/complete` 20 s, `AuthContext` 15 s); neither can hang
indefinitely again. A copy of `auth/complete` restored from the
back-forward cache could, since its effect never runs again, and a
fresh load of it said "sign-in expired" to a signed-in student; since
login-4 (2026-10-20) both its exits replace it in the history
(`location.replace`), so Back from the map never lands on it.

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
2026-08-27 — about **800 Supabase queries from one tab** (that figure
assumed ~11 table reads per `/api/student/data` call; the route made
16 at the time and makes 18 on this branch: `students` first, then 17
in parallel). The refresh storm
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
`{ throttled: false }` because capping those would visibly stall the UI,
and so does the first load (`first-load`, since 2026-10-20).
Default-on means a new automatic caller is capped without anyone
remembering to.

**Blocked calls report themselves** to `POST /api/client-event` (one line
per 30s per gate, never per call), which logs to Vercel as
`[client-event]`. **This is the first client-side visibility this app has
ever had** — every diagnosis before it depended on a student sending
screenshots. If the loop survives the cap, that log line names the
trigger.

**STILL UNKNOWN: what drives the loop.** The first candidate is ruled
out (2026-10-20): `refreshFromServer` calls `setStudent(fresh.student)`
with a fresh object on every refresh, and the data effect depended on
`[student]`, so each refresh ran one more full fetch. Traced, that was one
extra fetch per refresh, never a closed cycle. The effect is keyed on the
student's id since (map-1, lessons-2, progress-2), and the first load is
`refreshFromServer` itself, unthrottled, so every refresh applies the
whole answer, lessons and places included (an empty list never over a
loaded one), and the 30% questions while none are held (T-026).

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
| `/admin/login` | Email/password (Supabase Auth, `team_members` table). Since the admin rebuild (branch `night/admin`, 2026-10-20, not on production) it and `/admin/set-password` (the invite's page) wear the brand kit's dark look: the white Ecom University lockup, the name "Ecom University" (the old name is gone from them and from the top bar), one ink button. Since admin rebuild 2 (branch `night/admin2`, 2026-10-20, not on production; D1) signing in, setting a password and the lockup in the top bar all go to `/admin`, the Dashboard (`ADMIN_HOME` in `src/lib/admin/admin-frame.ts`). |
| `/admin` | **The Dashboard, the admin's home, rebuilt in admin rebuild 2 (WI-2, D3; branch `night/a2-dash`, 2026-10-20, not on production) in the brand kit's dark look.** Top: Today: Open tasks and 30% to decide, each tile a link to its page. Then The program: until the first Month 2 rate is in, the Bounty Program · joined chart two thirds wide and Month 2 conversion as a compact tile beside it (when the first renewals come, how many paid since 9 Oct, the days until the first rate); from then on Month 2's full tile with its chart beside Bounty's. Since the render review's fix round (2026-10-21) the Bounty Program is on the left and Month 2 on the right in every state (Month 2 took the left once it had a rate), the two cards as tall as each other (the compact one stopped short), each source line at its card's foot (until the owner's review took the lines away, below); Month 2's countdown is a plain bar (its knob read as a slider); the three sections sit the same distance apart (each title row 20px, the Insights link's 44px target hanging over its row); Today's tiles say "Open tasks" once, their links reading "Go to Tasks" and "Go to 30% off". Then Trends · last 14 days: Active on platform, Canceling, Churned, Avg progress. (This order since the review's fix round, 2026-10-21: Month 2 and Bounty were on top, Month 2 full width while it had nothing to show.) Today's two tiles say where their number comes from; the tiles with a chart have "How it's counted" (the (i) button) with the whole rule. Since the owner's review of the preview (2026-10-21; branch `night/admin3`, not on production) no program or trend tile has a source or explanation line under it: gone are Active's "Whop status now, the line from the nightly snapshot", Canceling's "pressed cancel" beside its number and its source line, Churned's "Access ended, per day" and "The nightly snapshot", Avg progress's "The nightly snapshot, built ...", Month 2's "Students on the monthly plan who first paid from Fri 9 Oct", the Bounty Program's "Students on the monthly plan since Mon 25 May who joined on the bounty site" and its "Joined per day" over the bars (a 14 days with nobody still says "Nobody joined in these 14 days."). The (i) keeps every definition, and the room went to taller charts: the trend lines 76px (44 before), the Bounty Program's bars 156px (124), Month 2's line 144px (112). Beside the Bounty Program's 14-day number a small arrow says whether those 14 days beat the 14 days before them: green and up when they hold more, red and down when fewer, none when equal, the earlier count in its tooltip and in its words for a screen reader ("Up from 9 in the 14 days before"; `bountyTrend` and `Bounty.previous14`, the 14 UTC days before the window, in `dashboard-metrics.ts`; `BountyArrow` in `DashboardView.tsx`). Month 2 counts only the students on the monthly plan who first paid on or after `DISCOUNT_LAUNCH_DATE` (9 Oct): until the first of them has resolved (the renewal and its week of grace, about 15 Nov) it shows "First renewals from Mon 9 Nov", how many paid since 9 Oct and the days until the first rate, never 0% and never the earlier students' rate. Since the review's fix round its read also takes the students Whop marks expired (`DASH_STUDENT_STATUSES`): the sync keeps an expired membership's `canceled_at` as for a cancel and Month 2 judges a student by those dates, so leaving them out took a student who did not renew out of the denominator; every other tile gets the rows it always had (`sharedPopulation`, active, past due and canceled). Bounty, Active, Canceling and Churned keep their definitions; Churned adds exactly 14 days (the old read took 15), and a day with no snapshot row is a gap in a line, no longer a 0. Open tasks is the Tasks page's count, from `admin_config.tasks_reset_at` on once v109 has written it (no row: every open task). 30% to decide is the 30% page's Applied tab: the pending requests made from `DISCOUNT_ELIGIBLE_FROM` (1 Oct). Avg progress is one metric for the number and the line: the nightly snapshot's `avg_progress_cohort`, the number its newest row (its source line said when that row was built, until the owner's review), the line's readings from the switch's date (`curriculum_reset_at`) only, so the old course's 36% no longer sits beside the new course's numbers; since the render review's fix round (2026-10-21) the line is drawn on the same 14 days as the other trends, the days before the switch empty ("Before the switch" in its readout and table), its readings at the right end with "From Mon 19 Oct" over them (`AvgProgress.from`): it held the 2 days alone, stretched across the tile. Since that review's second round (2026-10-21) a run of 3 readings or fewer is a dot on each reading joined by its line (`SHORT_RUN` in `TrendChart.tsx`; a reading alone is a dot), so the 2 readings the day after the switch are 2 dots and a short line, never a 20px stroke at the end of an empty chart; those dots are 6px with no ring, and no ringed last-reading dot sits on them, so on a phone, where the 14 days are about 10px apart, the line still shows between them. A read that fails shows "Couldn't load" on each tile it feeds, and the line at the top says why in plain words, each reason once (`src/lib/admin/read-failure.ts`), with every failed read and the database's own text behind a closed Details, and Retry; no failed read is ever shown as 0. When no tile could be drawn (every read failed, or the reads every tile needs), the header says "Couldn't load" with the warning dot as every page's header does (`nothingLoaded` in `dashboard-metrics.ts`, `FailedMeta`), where it said "Updated 10:30" (since the render review's second round). Refresh reads every number again. Sync Whop and rebuild (founders and admins, as before; until the review's fix round it was the only button and read "Refresh") calls `POST /api/admin/refresh-everything`, about 2 minutes, then reads everything again and shows for 12 seconds what each step did, a step that failed inside a 200 included. The loader is `page.tsx` (`readDashboard`), the numbers `src/lib/admin/dashboard-metrics.ts`, the view `src/components/admin/dashboard/` (`DashboardView.tsx`, `TrendChart.tsx`: one series in Airy Blue, hover and keyboard readouts, a table for screen readers). Dev page: `/dev/admin/dashboard?state=full|renewed|empty|loading|error|partial&role=founder|admin|csm&refresh=ok|fail|partial`. Proof: `client-tests/dashboard.test.mjs` (81 checks; 86 since the review's fix round) and the `dash` part of `world-tests/admin-pages.mjs` (148 checks over 26 measured states, the lowest readable text 4.71:1, Canceling's red arrow; the whole run `PASS 805   FAIL 0   NOT COVERED 0`, 146 measured states, on 2026-10-20 with a dev server on port 3401 and no `.env.local`). **Month 2 conversion produced no usable reading before 2026-08-07** — see the warning under this table before citing any historical M2 figure. |
| `/admin/journey` | Student journey board (per-week columns, activity overview, drawer detail). **Since admin rebuild 2 (branch `night/a2-tasks`, lane WI-5 and WI-6, 2026-10-20, not on production; D8):** in the brand kit's dark look; the new program's students only, a first real payment on or after `DISCOUNT_LAUNCH_DATE` (2026-10-08T22:00Z, midnight starting 9 October in Croatia), with a Whop membership that is active, past due or canceled (it was the $97 monthly plan from 25 May, then from 2026-10-20 any plan); since the owner's answer of 2026-10-21 (branch `night/admin2`, not on production) only course members on one of the two $97 monthly plans, `MONTHLY_97_PLAN_IDS` in `src/lib/constants.ts` (the visible `plan_4ZrwR4PmBsVsx` and the hidden `plan_UoKS5Tjqvp0Cj`), the same plans as All students, so the two pages agree and a yearly plan, an ETfB owner's plan or no plan on file is on neither; the header's line says so ("course members on a $97 monthly plan with a first payment on or after Fri 9 Oct"); the columns as before (Week 1 to 4 by days since the first payment, Churned, Month 2+); the header counts the students who have not churned by activity; a failed read says so (the students read is the page's error with Retry, a failed progress or course read, and an area read until the owner's review, a line above the board and "Couldn't load" on the cards; since the review's fix round each in plain words, the database's own text behind Details), never an empty board, 0% or the first area. Since the render review's fix round (2026-10-21) the board sits in the page's 1084px column, as every other page's content does (it ran to 1584px, and at 1280px wide its Month 2+ column was cut off at the window's edge): six columns of at least 164px, 8px apart, fit side by side from 1120px wide; narrower they keep 232px and the board scrolls sideways inside itself, out to the window's edges on a phone, never the page. Since the owner's review of the preview (2026-10-21; branch `night/admin3`, not on production) the page takes the window's whole width with the pages' side margins (`ListPage wide` in `list-parts.tsx`: 48px each side from 1024px wide), the six columns widening with the window; they still fit side by side from 1120px and scroll inside the board narrower. A card holds the name (the admin's one name part, `src/components/admin/student-name.tsx`, a link to the student's page), the day at the end of the name's line (under a name too long to share it, so a long name breaks between its words wherever they fit the card), the activity word, the progress as a percentage ("38% done"; "Progress couldn't load" when it could not be read, never 0%) and the last activity, and nothing else since the owner's review: the @username, the area chip, Canceling, Payment failed and the progress bar went, a card with a one-line name is about 90px tall, and the board no longer reads `discord_username`, `cancel_scheduled_at`, where each student is (`student_current_region`) or the course's areas. Its progress and last counted lessons are read for the board's students alone, by id in batches of 100 (`readForStudents` in `people-common.ts`, and `loadCourseActivity` handed the ids), where they read every student's row page by page. The rest of the card is one button under it that opens the drawer, which keeps the student's whole detail; until the owner's review the card had the @username after the name and the day on the line under them, and the area's numeral in the primary ink (Airy Blue marks a link). A failed read says "Couldn't load" in the header too. Since the review's fix round each column is as tall as its cards (no column scrolls inside itself; the page scrolls), the activity tiles' numbers are white with their colour in a dot, and the drawer opens on the student's name (the name part since the render review's fix round) with "Open the full page" beside it and a 30% block with no ads tick (the student page keeps the tick, under More). A card opens the drawer, mounted fresh for each student (keyed by id) and fed by the student page's own hook (`useStudent`), which drops an answer that lands after it moved on. Since the render review's second round (2026-10-21) a username too long for its card ended in an ellipsis on a line of its own, the whole username in its title (it broke between any two characters), until the owner's review took the username off the cards; and the drawer's blocks whose read failed start with the warning dot a failed number has (`SectionFailure`). Since 2026-10-22 (branch `night/action-done`, not on production) the drawer's Action items say "Done" and show no link for the seven with nothing to post (`isDoneOnly` in `src/lib/world/action-items.ts`; on `a5l08` and `a5l12` "Done" is the action's word whether or not the video is watched, as "Handed in" is for the others), even when a link was saved on the row before, never an empty link; the other three "Handed in" with "Open the post" as before; any of them not done "Not yet" (`actionItemStatus` in `student-detail.ts`). The dev page's made-up Maximilian did `a6l03` ahead of the order, so his drawer holds both kinds. Page: `src/components/admin/journey/JourneyView.tsx`; reads and rules: `src/lib/admin/journey-board.ts`. |
| `/admin/students` + `/admin/students/[id]` | Table view + detail. Since the admin rebuild (branch `night/admin`) a student's page links to `/admin/discounts?student=<id>`, where it said "Gate lesson (The Editor's Teardown): completed / not yet" (C16). **Since admin rebuild 2 (branch `night/a2-tasks`, 2026-10-20, not on production; D9), both in the brand kit's dark look.** All students lists every student with a real first payment (`first_paid_at` not null), any membership or date (it was the $97 monthly plan from 25 May, unlabelled), and since the owner's answer of 2026-10-21 (course members only, and only the $97 ones; branch `night/admin2`, not on production) only those on one of the two $97 monthly plans, `MONTHLY_97_PLAN_IDS` (the visible plan and the hidden one; from 2026-10-20 to then, any plan), so a yearly plan, an ETfB owner's plan or no plan on file is not on it. Since the owner's review of the same day (branch `night/admin3`, not on production) only those whose first payment is on or after `DISCOUNT_ELIGIBLE_FROM` (2026-09-30T22:00Z, 1 October in Croatia), drawn in the database (`first_paid_at >= DISCOUNT_ELIGIBLE_FROM` beside the plans line), so every student on the journey is on it; the list held every $97 member who ever paid. Their progress and last counted lessons are read for the listed students alone, by id in batches of 100 (`readForStudents` in `people-common.ts`), where every student's row was read page by page. The header's line says who is listed ("Course members on a $97 monthly plan who first paid on or after Thu 1 Oct, newest first payment first."; it read "who have paid at least once"); newest first payment first, 100 at a time; the column that read "Discord" reads "Username" (`students.discord_username` holds a Whop or a Discord username); search, the membership pills Active, Payment failed and Ended (canceled and expired together), each with its count, Active pressed when the page opens (`STATUS_FILTERS`, `statusCounts`, `DEFAULT_STATUS_FILTER` in `students-list.ts`; until the owner's review All, Active, Payment failed, Canceled and Expired, All first), and sorts (newest payment, name, progress, last active). A student's page, in this order since the review's fix round: the header (Day N since the first payment, membership, Canceling, activity, the area), Progress, Streak, First paid, Last active, the Whop sync block ("Synced since the switch", "Not synced since the switch" when `last_sync_at` is before `curriculum_reset_at`, by `whopPulled` of `src/lib/admin/thirty-view.ts`, or "Never synced"; the backfill's note with a grey dot, a last error with a red dot), the latest 30% request of any date in the 30% page's words and colours (Applied, Approved, Rejected, Code Applied: `src/lib/admin/discount-status.ts`, which the 30% page and the Survey use too), the lessons per area (folded; each area one row with a chevron, the whole row the button), the 3 quick DMs in the messages draft's words (`quickDms` in `student-detail.ts`: Welcome with the program link from `admin_config.program_login_link`, Check-in naming the student's area, Encouragement counting the lessons done; a part not known is left out in words), and at the foot "Leave out of the tasks" (the exempt tick) with "Ad submissions verified" (the ads tick, which approving the 30% does not need) under a closed More. On both, every read that fails says so ("Couldn't load", the page's error with Retry, or "No student has this id."; since the review's fix round in plain words, the database's own text behind Details), never an empty list, 0%, 0 days or "No application submitted"; no plan on any row (since 2026-10-21 All students' header names the $97 plan once, as who is listed). Since the render review's fix round (2026-10-21): All students' names look as on every admin page (the name part, as words inside the row's link), a student with no username has an empty Username cell (a screen reader hears "No username"; it read "None"), the membership filters and the sorts stay on one line that scrolls sideways on a phone, and a failed read says "Couldn't load" in the header too. A student's page keeps its four numbers on one line on a phone (20px there, 28px from 640px), a number whose read failed is a warning dot and "Couldn't load" at the body's size (it was a 28px value), Progress is in the primary ink; the Whop sync block is one line (synced since the switch or not, when, the lessons it brought in, and "the last run failed" when it did) with the counts, the note or the last error and the Whop lessons with no lesson here under a closed "Sync details". The journey's drawer shows the same numbers the same way. Since the render review's second round (2026-10-21) every block of a student's page whose read failed (the Whop sync, the 30% request, the lessons) starts with the same warning dot as a number that failed (`SectionFailure` in `StudentDetailView.tsx`, which the journey's drawer uses too), and All students' wide row gives the name and the username it cuts with an ellipsis their whole text in a title. Pages: `src/components/admin/students/StudentsView.tsx` and `StudentDetailView.tsx`; reads and rules: `src/lib/admin/students-list.ts` and `student-detail.ts`. |
| `/admin/templates` | The message templates and the Message settings panel. **In the brand kit's dark look since admin rebuild 2 (WI-8, PRD D6 and D12; branch `night/a2-templates`, 2026-10-20, not on production).** On top, Message settings, folded when the page opens, for every role and with a warning standing or not (since the review's fix round; it opened on its fields): its title, one sentence on what it holds and who can change it, Show settings (Hide settings once open) and its warnings, always shown. Opened: the program link and the Discord invite link (`{programLink}`, `{discordInvite}`), and the master switch with the 3 Discord switches under it (disengagement alerts, task summary, day 28 message, which says no scheduled job sends it); every team role reads it, founders and admins change it through `PUT /api/admin/config`. It warns when the Discord link is empty ("4 messages send an empty Discord link.", counting the templates that go out with `{discordInvite}`) and when the program link is not on `sprint.ecomuniversity.com`; a switch under the master says when it is on but nothing posts because the master is off, and the master's Turn on asks once, naming what starts posting. Then every template by day: its title, its bucket in words and its numbers (sent, success, graded on the old course, replied, from `/api/admin/templates/stats`), Off where its switch works, Unsaved. Opened: on or off (`TemplateOnOff`, decided in `src/lib/template-on-off.ts`: custom templates, `stalled.*`, `welcome.day1`, `month2.entry`, and on the new course `noship.*` and `pace.*`; `nolessons.*` and W2.2 / W2.6 / X.1 show one line saying their tasks are made whether on or off; Turn on waits, with why, while unsaved changes or saved conditions name a lesson or area the live course lacks or a clock metric on the new course), the fields, the conditions ("Membership status" where it read "Subscription status"), the message, a preview that fills the links from the live values (a placeholder left as written says why), Save, and Delete for a custom template only (the route refuses a built-in too). Save sends only the fields that changed (it sent the bucket and `{"all": []}` conditions with every save, which check-csm-tasks' auto-dismiss reads as never matching). A csm reads everything and changes nothing. Since the review's fix round Refresh and New template (the page's one ink button) sit in the header, under the description on a phone; an open template has Delete template in red at the start of its buttons and Save at the end; a yes-or-no condition reads "is yes" or "is no", and `is_canceling` has one label, "Is canceling (cancel scheduled)", in the select as in the sentence under it (the select read "clicked cancel, still has access"); on a wide window with a mouse the fields' words are 14px (16px on a phone, so iOS does not zoom). |
| `/admin/tasks` | CSM task queue (open / completed / dismissed). Open tab is priority-first: Canceling (derived from the STUDENT row via `isCanceling`, pinned on top regardless of template) → Cancel path → At risk → Events & wins, oldest-first with waiting-time chips; rows carry the behavior summary, the @username, Canceling, Payment failed and No Discord pills; a queue line (open by tier, oldest wait, sent today in Croatia). Sent/Dismissed keep recency grouping, each row saying how and when it was closed. Queue \| Insights links (since the review's fix round "Outreach insights →" in the header, and "← Queue" on the insights page, as words: the pills looked like the status tabs). **Since admin rebuild 2 (branch `night/a2-tasks`, 2026-10-20, not on production; D7):** in the brand kit's dark look. Once migration v109 has run (`admin_config.tasks_reset_at`), To do, Sent and Dismissed list only the tasks created on or after the reset, and an Archived tab lists every older task, newest first, read only (no Copy DM, Mark sent, Dismiss, Move to To do or reply buttons, in the row or its detail), each row saying how it was closed ("Dismissed Tue 20 Oct by the reset for the new program"). Before v109 there is no Archived tab and every task is on the three lists. `GET /api/admin/tasks` draws the line in the database and answers the reset and the 2 DM links with the lists (`src/lib/admin/tasks-reset.ts`); the tabs show its exact counts; a list cut at 500 says so. A dialog closes as soon as its call went through. Run task checks (it read "Refresh" until the review's fix round; founders and admins: the Whop sync and the snapshots too, about 2 minutes) runs the task checks as before, then reads the list again. A canceling task's edge is red, a cancel path or at risk one amber; Dismiss's confirm is the red "Dismiss the task"; while the list loads or failed, the tabs stay with no counts. Since the render review's fix round (2026-10-21) a row's name is the admin's name part (a link to the student's page, @username after it), "Details" opens the task with its DM (the name did), the actions sit on the right from 768px wide and under the words on a phone, the wait is on the line under the name, the tabs scroll on one line on a phone, the task's dialog names the student the same way (its Username box and "Open the student" link went; "No username on file" says when there is none), and a failed read says "Couldn't load" in the header too. Page: `src/components/admin/tasks/TasksView.tsx`; rules: `src/lib/admin/tasks-view.ts`. |
| `/admin/tasks/insights` | Outreach insights (v85.3, Phase 0 measurement surface). Range selector (30d / all-time), KPI row (students reached, sent, median task→send, SAVES, SUCCESS RATE), unmarked-outcomes nudge, sortable per-template table (sent, time→send, per-family success with definition under each title, replied), plain-language methodology box. PER-FAMILY SUCCESS: stalled→logged in ≤72h, nolessons→started a lesson, noship→shipped an action, pace/custom→came back (dormant sends only), canceling→currently active with cancel withdrawn (current-state, no timing attribution until cancel_rescinded_at exists), events→not graded. All numbers from `src/lib/outreach-insights.ts`. **Since admin rebuild 2 (branch `night/a2-tasks`, 2026-10-20, not on production; D7, D12):** in the brand kit's dark look; once v109 has run, only the tasks created on or after `tasks_reset_at` count, whatever the range (the route reads it and hands it to `computeOutreachInsights` as `tasksFloorIso`; a failed read is a 500), so the second range reads "Since the reset, Tue 20 Oct" instead of "All time"; a save is "still a member" (it read "still subscribed"); no em dash in its words. Since the review's fix round, while the reset is under 30 days old "Since the reset" is the one range and no range pills show (the last 30 days would count the same tasks); the median tile reads "Time to send"; how the numbers work is folded under "How these numbers work"; under 640px each template is a card (its name and success rule, then Sent, Time to send, Success and Replied two by two) where the table scrolled sideways. Since the render review's second round (2026-10-21) Saves and Success rate are in the primary ink like the other numbers (they were Airy Blue, the colour of a link, and are not links). Page: `src/components/admin/tasks/InsightsView.tsx`. |
| `/admin/discounts` | **30% off (admin rebuild 2, D4 and D5, branch `night/a2-thirty`, 2026-10-20, not on production; rebuilt first in the admin rebuild, branch `night/admin`; it was "Pending discount review").** Tabs Applied (status pending) · Approved · Rejected · Code Applied (status applied), each with its count, Applied open first, every tab oldest first, from `GET /api/admin/thirty`. It lists the requests made from 1 October (`DISCOUNT_ELIGIBLE_FROM`, Croatia); older ones stay in the database (on 20 October none of them was pending or approved). A row's top line is the student: the name (to `/admin/students/<id>`), @username (`discord_username`, which can hold a Whop username) and the membership pill (Active, Payment failed, Canceled, Expired). Then only the date applied, the verdict line on an Applied row (meets the rule or why not, with "57 of 61 videos" and, for a student missing videos whose Whop progress was not pulled since the switch, that too), the coupon, and the actions: Approve (on exactly when the verdict says yes) and Reject with an optional reason on Applied, Copy and Mark code applied on Approved. The coupon (D5): a student whose stored membership row says a discount is on the next renewal gets the approve route's own refusal as the verdict, "This student already has a discount on their membership (evolve10).", and no override until the owner's review (below). Since the render review's fix round (2026-10-21) such a row has no Approve: Reject is raised and its reason starts filled in (it had no Approve anyway either until the owner's review gave a founder or an admin one there). Since that review's second round (2026-10-21) the reason is the map's own sentence, "You can't apply for this discount because you already have a discount applied to your account." (`COUPON_REJECT_REASON`, which is `MEMBERSHIP_DISCOUNT_LINE`), because the student reads a rejection's reason on the map's 30% panel; the team can change it before sending (it read "Already has a discount on their membership (evolve10)", the team's words about the student). In Approve's place the row has "Check Whop again" (the same round), a small link like Approve anyway: it asks Whop now for that one student (`POST /api/admin/thirty/check-coupon`, through the approve route's own reader, `checkMembershipDiscount`, which stores the answer), says in the notices what Whop said ("Whop still shows a discount on ...'s membership (evolve10)." or "Whop shows no discount on ...'s membership now. The 30% rule decides this request again.") and reads the list again, so a code taken off the membership since the stored read brings back the rule's verdict and Approve; a reason still as it was filled in goes with the answer it was for, and Whop giving no answer is the route's sentence on the row, nothing changed. The coupon cron reads every student holding a pending request too, so a stale stored answer also heals by itself within 2 hours. (The review's fix round had kept Approve on beside it, with "Approve asks Whop again first.") An Applied row the rule says yes to with no stored answer for its membership says "Coupon not checked yet. Approve asks Whop first."; a row refused for another reason does not. When the student's stored Whop id is missing or is not a membership's (the webhook has stored a payment's id there), the cron and Approve find the membership through the student's Whop user since T-122 (2026-10-21, branch `night/admin3`, not on production; "The coupon" under Discounts), so the row reads as any other: the stored answer, which counts for that student whatever membership it was read from, as there is none on file to compare (`storedRowApplies`), or "Coupon not checked yet. Approve asks Whop first." Until then neither could ask Whop, and the row said "Coupon not checked: the student's Whop membership is not on file, so Approve can't ask Whop. Check Whop before you approve." An Approved row's coupon is Whop's answer now (`GET /api/admin/thirty` asks for each Approved student and writes nothing): with a coupon it reads "... (evolve10). Check Whop before you add the 30% code."; when Whop gives no answer the stored row stands in, with its day ("Whop gave no answer now; this is its answer of Mon 19 Oct."); with neither, "Couldn't ask Whop about a coupon on this membership. Check Whop before you add the 30% code." (with no membership on file, "Couldn't ask Whop about a coupon: the student's Whop membership is not on file. Check Whop before you add the 30% code.": this read asks by the membership on file alone, where T-122's check goes through the Whop user) (until then only a stored row could warn there, and the cron leaves approved students out, so the warning never showed). Since the render review's fix round neither an Approved nor a Code Applied row warns about the team's own 30% code, which Whop shows on the membership as a discount once the code is added there: an ECOM30 code, or the request's own `whop_promo_id` (the page now reads it), named or not (`isThirtyCode`, `Coupon.ours`, `couponWarns` in `src/lib/admin/thirty-view.ts`). "Approve anyway" is a small text link in Approve's place. Until the owner's review it showed to every team member after any refusal but the coupon's and sent the override, which the approve route still refused for a coupon. Since the owner's review of the preview (2026-10-21: founders and admins approve past any check; branch `night/admin3`, not on production) it is a founder's or an admin's (the real page hands the signed-in member's role through `ThirtyPage.tsx`), on every Applied row a check refuses: the rule's verdict, the coupon's, and a refusal the approve route answered when Approve was pressed (its code "rule": the rule said no, a read it needs failed, or the old course's 409 "The course changed and this check cannot run. Nothing was approved."). Such a refusal stays on the row in the route's words and is remembered, so Approve anyway takes Approve's place there although the list's verdict says yes (Approve used to come back, to be refused again). It asks once, inline, naming what it skips: "Approve anyway skips the 30% rule, and creates the student's Whop code now. The rule says: ... A discount already on the membership is still checked first."; on the coupon's row "Approve anyway skips the coupon check and the 30% rule, and creates the student's Whop code now. This student already has a discount on their membership (evolve10)."; after the route's refusal "Approve anyway skips the check that refused this approval, ... The check said: ...". Then it creates the code through the approve route's `override` (the rule), with `overrideCoupon` as well on the coupon's row (`anywaySkip` and `approveAnywayText` in `src/lib/admin/thirty-view.ts`). What Whop does with the 30% code on a membership that already holds a discount has not been checked, so the confirm says nothing about it. A csm sees no Approve anyway, and the approve route refuses a csm's `override` or `overrideCoupon` with a 403 before it reads anything. Reject is the row's quiet button, its confirm the red "Reject the request". Gone with D4: Can still earn, the plan pill, the Discord buttons, the last contact, Mark messaged, the survey answers and the payment and deadline facts. When the stored coupons cannot be read (a database without v111) the page judges by the rule alone and no row shows a coupon; since the owner's review no sentence above the list says so (it read "Couldn't read the membership coupons, so no row shows one. Approve still asks Whop before it makes a code."; `couponsUnread` stays in the route's answer). A 409 from approve, reject or mark-applied shows its sentence and reads the list again; a Whop code in it (made for a request someone else decided, to delete in Whop) can be copied, and the sentence stays until dismissed. A coupon refusal from approve shows the route's sentence and reads the list again, so the row turns to the coupon. What a button did shows fixed at the bottom of the window; a failed reload after a decision adds its own line and keeps that row's buttons off until a read works. The tabs sit on one line from 390px wide (under 400px with 8px of padding and 12px words); narrower, the row scrolls sideways (since the review's fix round; they wrapped onto two lines). While the list loads or failed, the tabs stay with no counts and Refresh stays in the header. The tab names and colours come from `src/lib/admin/discount-status.ts`, which a student's page and the Survey use too. `?student=<id>` keeps every tab to one student, `?tab=` picks the tab (`applied`, `approved`, `rejected`, `code-applied`; the old `decide` and `code-added` still open theirs). A row's actions sit on the right from 768px wide and under the words on a phone (`RowSplit`), its name is the admin's name part, and a failed read says "Couldn't load" in the header too (all three since the render review's fix round). The dev page `/dev/admin/discounts` renders it with made-up data (`src/app/dev/admin/fixtures.ts`; `?state=owncode`: the team's own codes already on the Approved memberships in Whop; `?state=stalecoupon`: evolve10 taken off Tara's membership in Whop since the cron stored it, so Check Whop again brings Approve back; `?whop=down`: Check Whop again gets no answer; `?role=admin|founder|csm`, default admin: whose page, and the stand-in refuses a csm's override as the route does; `?approve=coursechanged`: a plain Approve answers the old course's 409 with code "rule"), and `world-tests/admin-pages.mjs --only thirty` drives it. The decisions stay the existing routes. |
| `/admin/insights/progress` | Progress + retention insights. (Listed until 2026-10-20 as `/admin/insights`, beside an `/admin/alerts` page; neither address exists.) **In the brand kit's dark look since admin rebuild 2 (WI-9, branch `night/a2-templates`, not on production)**, laid out for a phone: the range as 44px pills (7, 14, 30, 90 days, All, Dates), the activity (or pace) of the students right now, the current sprinters, the Bounty Program claims, and the charts for Avg progress, Active students and Churned, drawn at their box's width so their labels stay 11px on a phone. A read that fails says so on its card (the sprinters' and the claims' reads showed 0 on a failure), and the claims are paged on `student_id` (they were paged on the claim time, which rows share). Since the review's fix round Avg progress starts at the course switch (`curriculum_reset_at`), as on the Dashboard, so the old course's 36% no longer drops into the new course's 3% (a failed read of the switch's date says so on that card and draws no line); the charts are the Dashboard's (`TrendChart`), with round values on a left axis and each card's change over its range; a range of 7 days counts 7 days, today among them (it counted 8); the counts are white, their colour in the dot. |
| `/admin/feedback/survey` | The 30% application's survey answers, one card per application, newest first. **In the brand kit's dark look since admin rebuild 2 (WI-9, branch `night/a2-templates`, not on production):** the status as the 30% page names it (Applied for `pending`, Approved, Rejected, Code Applied for `applied`; the pill printed the database's word), the average recommend score (a plain mean of the scale answers, with the scale, not an NPS score), and a read that holds at any size: questions and answers paged on their id, the applications and their students by id in batches of at most 100, and a failed read shown with what failed and Retry (the page sent every id in one `.in()`, paged its answers on `created_at`, which the 6 answers of one application share, and checked no error). The csm role gets the restricted page. Since the review's fix round it lists the applications from 1 October (`DISCOUNT_ELIGIBLE_FROM`, the 30% page's window; it listed every application ever made) and says how many older ones it leaves out, with Show them; a summary card gives the average recommend score, how the scores spread and the pace answers counted; a card shows only the questions its student answered; the tabs follow the 30% page's order (Applied, Approved, Rejected, Code Applied). Question 1's live words still name the old brand until the owner runs the messages draft's SQL (the development page already reads "Ecom University"). |
| `/admin/team` | Who can sign in to the admin and their roles; founders only (the routes check it too). **In the brand kit's dark look since admin rebuild 2 (WI-9, branch `night/a2-templates`, not on production)**, laid out for a phone: the invite (email with the example `name@ecomuniversity.com`, full name, role with what it can do), then each member with their role, the day they were added and Remove, which asks once and says the login is deleted too. A founder cannot change their own role or remove themselves. No em dash (one stood for a member with no name). Since the review's fix round Send invite is the page's one ink button, a founder's own role is a plain label (it was a select that could not be changed), Remove's confirm is the red "Yes, remove", and the fields' words are 14px on a wide window with a mouse. |
| `/admin/cutover` | **The course switch's status page (cutover WI-10), founder and admin only; a CSM gets the restricted page.** Not in the sidebar: it is opened by its address. It fetches `GET /api/admin/cutover-status` and shows "All good" or one line per problem, then the running build's values (student home, whether the world is open to everyone, catalog shape, catalog table, whether `WHOP_COURSE_ID` is set and its last 4 characters, Vercel's deployment id and commit, "Not reported" where Vercel gives none) and the database's (the switch's moment, the area ids, lessons, counting lessons, lessons with a Whop id). It is the only place a build-time value can be seen after a redeploy, so it is looked at again after every redeploy on the evening. The problem lines come from `cutoverProblems()` in `src/lib/curriculum-reset.ts`. In the brand kit's dark look since admin rebuild 2's render review fix round (2026-10-21; listed in `REBUILT_PAGES`), its words unchanged: the page reads the status and `src/components/admin/cutover/CutoverView.tsx` shows it in the other pages' frame (`ListPage`, `ListHeader`), loading as skeleton rows, a failed check's title in the readable ink with a red dot (red words measure 3.9:1 on the dark card), a CSM's notice with its own reason (the default one has an em dash). Dev page: `/dev/admin/cutover?state=after|before|problems|error|loading`. |
| `/admin/not-activated` | **Not activated: the students who paid and never signed in to the app, by cohort (A with Discord, B without), the next day-tier DM and whether Whop shows them watching.** Removed in admin rebuild 2's review fix round and put back byte for byte as it was at `d0ebe76` in the render review's fix round (2026-10-21): it was not one of D2's removals. In the dark look (listed in `REBUILT_PAGES`); no entry in the bar, as at `d0ebe76`, opened by its address. Its words are the old page's, three em dashes and an arrow among them (an empty email, a student past the tiers, the empty list's sentence), which every rebuilt page has none of. It reads the browser's Supabase client as before (`students`, `student_milestones.first_sprint_login_at`, `student_whop_sync`), the launch cohort on the paying plans. |
| `/admin/feedback/lessons` | **Lesson feedback (admin rebuild 2, WI-7, D10; branch `night/a2-feedback`, not on production).** Founders and admins; the csm role gets the restricted page (the top bar already hides it from them). The brand kit's dark look (in `REBUILT_PAGES`). From `GET /api/admin/lesson-feedback`: three numbers in one card (the average of every rating, how many ratings and how many with a comment, how many of the 135 video lessons have one), then each area in route order ("01 Introduction") with its average, ratings and lessons rated (an area with none says "No ratings yet" beside its name), and only its rated lessons, the newest rating first (`splitRated` of `lesson-feedback.ts`, since the review's fix round: the page listed all 135 lessons in course order, a wall of "No ratings yet."). A rated lesson shows its stars to the nearest half, its average to one decimal and its count, then its 3 newest comments (stars, the student's name linking to their page, or the email when there is no name, the day in Croatia) and "Show all N comments"; the area's lessons with no rating are one muted line, "N lessons with no rating yet", that lists them in course order when pressed; a lesson's id is only in its row's title; with no rating at all the page says so once ("No ratings yet. Counting from Mon 19 Oct, when the new course started."). Only ratings since the course switch. A failed read shows "Couldn't load lesson feedback." with the route's sentence and Retry, never zeros; a failed Refresh keeps the page with its own line. The view is `src/components/admin/feedback/LessonFeedbackView.tsx` (the page and its csm gate are `src/app/admin/(authenticated)/feedback/lessons/page.tsx` and `LessonFeedbackGate.tsx`); `/dev/admin/feedback/lessons` draws it with made-up data (`?state=full|empty|loading|error|unplaced|stray`, `?reload=fail`). `/admin/lessons` still redirects here. |
| `/journal/[studentId]` | Student daily-notes journal (read-only for team) |

**Removed in admin rebuild 2 (branch `night/admin2`, 2026-10-20, not on production; D2).** Today (`/admin/today`), Brand Owners (`/admin/etfb`), Stats (`/admin/stats`), Settings (`/admin/settings`) and Discord test (`/admin/discord`), with their routes (`/api/admin/today`, `/api/admin/today/mark`, the 5 under `/api/admin/etfb`, `/api/admin/stats` and `/api/admin/stats/views`, `/api/admin/dm-toggles`, `/api/admin/preview-day28-dm`), the modules only they used (`src/lib/admin/today-data.ts`, `src/lib/admin/support-list.ts`, `src/lib/etfb.ts`, `src/lib/whop-stats.ts`, `src/lib/whop-stats-catalog.ts`, admin-auth.ts's Stats allowlist, dm-toggles.ts's `writeDmToggle`), their vercel.json pins, dev pages and tests. No migration: `etfb_team_links`, `etfb_seat_decisions`, `stats_saved_views` and `current_user_is_stats_owner()` stay in the database with no reader in the app, and the `support.*` records Today wrote stay in `tasks` (nothing reads them as a last contact since D4 took that off the 30% page; this line said the 30% loader still did). The ETfB and Apex product ids moved to `src/lib/whop-products.ts` (D11). The 2 message links and the 4 Discord switches that Settings and Discord test edited are written only through `PUT /api/admin/config`, now limited to those 6 keys (`src/lib/admin/config-keys.ts`; a switch takes "true" or "false" only); the Templates page's Message settings panel (WI-8, D6) is their page. Their values were not changed. The review's fix round (2026-10-21) also removed Not activated (`/admin/not-activated`: no entry in the bar and no link led to it since D1; the render review's fix round put it back, see its row) and `src/lib/admin/plans.ts` (`planLabel`, read by nothing once D4 dropped the plan pill), with the leftovers no page used: `timeLeftText`, `DiscordReach`, `WhopNotPulled`, `lastContactText` and `RAISED_LINK` (`list-parts.tsx`), `PillLinks` (`people-parts.tsx`), `PacePill`, `IconButton` and `Avatar` (`ui.tsx`), the `LastContact` shape and the reason helpers of the first rebuild (`thirty-view.ts`) and `bucketByDay` (`insights-data.ts`). `/admin/cutover` stays, opened by its address, for the owner to keep or remove (in the dark look since the render review's fix round). Since the render review's fix round the removed pages' old addresses, and any admin address with no page, land on the admin's own not-found page inside the frame (the team guard, the top bar, the dark look) with "Go to the Dashboard": the catch-all `src/app/admin/(authenticated)/[...missing]/page.tsx` calls `notFound()`, which the group's `not-found.tsx` (`src/components/admin/not-found/AdminNotFound.tsx`) answers, and the frame knows it by the catch-all's param (`useParams().missing`); they got the app's bare black 404 outside the frame. The development server streams, so its status line reads 200 there; the page's payload carries Next's 404. Dev page: `/dev/admin/missing`. dm-toggles.ts's `readAllDmToggles` went too (no caller since the Discord test page).

**The frame (admin rebuild, branch `night/admin`, 2026-10-20; admin rebuild 2, branch `night/admin2`, D1; not on production).** The top bar is `src/components/admin/AdminTopNav.tsx`, drawing `ADMIN_NAV` from `src/lib/admin/admin-frame.ts` (the one place to add, drop, order or role-gate an entry): the white Ecom University lockup (to `/admin`), then Dashboard · 30% off · Tasks · Students ▾ (All students, Student journey) · Feedback ▾ (Lesson feedback, Survey, both hidden from the csm role) · Templates · Insights · Team (founder only), no "More", no plan or subscription in it, the profile at the right; under 1100px wide one Menu button opens every entry as a list under the bar (C2). At 1100px a founder's 8 entries fit beside a name of about 120px with the lockup at full size; a longer name shrinks the lockup first (measured 128px at worst) and nothing overflows. The bar, the 30% page and the two sign-in pages wear the brand kit's dark look from `src/components/admin/admin-tokens.module.css`: a token class, put on `<main>` for the pages listed in `REBUILT_PAGES` (`src/app/admin/(authenticated)/layout.tsx`, one slot per lane of admin rebuild 2) inside `.admin-shell`, so `globals.css` is untouched. An entry there covers its page and the pages under it, except `/admin`, which covers itself only (`isRebuiltPage`). The other pages keep their light look under the dark bar until they move over (C1). `ui.tsx` gained two `Button` variants: `ink`, the sign-in pages' one primary action, and `raised`, the row actions, 44px tall (C15); its `ghost` and `subtle` read their corner and height from `--admin-button-radius` and `--admin-button-min-height`, which only the token class sets (a pill, 44px), so the light pages keep their look. The token class also sets `color-scheme: dark` and the kit's 2px Stalactite focus ring. The pieces the rebuilt list pages share are in `src/components/admin/list-parts.tsx`. Development-only pages with made-up data render the same components: `/dev/admin/frame?role=founder|csm|admin&ground=light|dark` (dark is the Dashboard at `/admin`; `&name=long` gives the member a name longer than the profile's 180px) and `/dev/admin/discounts` (`?state=` also `partial` and `novideos`, `?tab=`, `?student=`, `?conflict=1`, `?reload=fail`). Admin rebuild 2's lane WI-5 and WI-6 added `/dev/admin/tasks` (`?state=`, `?reset=none`, `?reload=fail`, `?tab=todo|sent|dismissed|archived`, `?role=`), `/dev/admin/tasks/insights` (`?state=`, `?reset=none`), `/dev/admin/students` (`?state=` also `partial`), `/dev/admin/students/<id>` (p-maya, p-jonah, p-priya, p-sofia, p-iris; `?state=`) and `/dev/admin/journey` (`?state=`, `?at=later`, `?drawer=<id>`), over `src/app/dev/admin/fixtures-people.ts`, where the student pages run their real builders; their shared pieces are `src/components/admin/people-parts.tsx`. `world-tests/admin-pages.mjs` renders every one of them (see Testing). Since the review's fix round (2026-10-21) `ListHeader` takes a page's buttons as `actions`, in a grid that keeps the title line 44px tall and in one place from loading to loaded and on a failed read (under 480px wide, two buttons or more go under the description); the `danger` button's label is Gunpowder in the dark look (`--admin-danger-label`: 5.2:1 on the red, where white measured 3.4:1) and stays white on the light pages; TeamGuard's loading screen is the dark ground with the bar's empty 60px (it showed a light page with a spinner first). Since the render review's fix round (2026-10-21) every admin page under the bar is in the dark look (`/admin/cutover` and `/admin/not-activated` joined `REBUILT_PAGES`, and the not-found page takes it from the catch-all's param), and the shared parts gained `FailedMeta` (a header's "Couldn't load", where "Loading" stood over a failed read), `PILL_ROW` (a row of pills that scrolls on one line under 640px instead of wrapping) and `RowSplit` (a row's actions on the right from 768px) in `list-parts.tsx`, `FoldSummary` (a fold's line with the browser's open/close triangle) in `review-parts.tsx`, `expanded` and `controls` (aria-expanded, aria-controls) on `ui.tsx`'s `Button`, and the one name part every page draws a student's name with, `src/components/admin/student-name.tsx` (a link to the student's page, 600, the primary ink with a hairline underline, @username after it; `asText` inside a row that is already the link). Since that review's second round (2026-10-21) the name part draws no underline on a name nothing opens from (no student id: "A student no longer on file" on Lesson feedback, "Unknown student" on the Survey), and keeps a username on one line: in its row's wrapping line it moves under the name when it does not fit beside it, and past the line's width it ends in an ellipsis with the whole username in its title (it broke between any two characters). `/dev/admin/discounts` also takes `?state=stalecoupon` and `?whop=down` (Check Whop again's two outcomes besides "still there").

**Templates, Survey, Team and Insights (admin rebuild 2, WI-8 and WI-9, branch `night/a2-templates`, 2026-10-20, not on production).** Each page is a loader and a view, so the view renders on a development page with made-up data: the loader (`src/app/admin/(authenticated)/<page>/<Name>Page.tsx`, beside a server `page.tsx` that gives the tab its title) hands the view (`src/components/admin/templates/`, `survey/`, `team/`, `insights/`) its real calls: `src/lib/admin/templates-transport.ts`, `team-transport.ts` and `insights-transport.ts` (route calls through `src/lib/admin/call-route.ts`, with the same sentences as the 30% page's), and `loadSurveyData`. The rules sit in `src/lib/admin/templates-data.ts` (the loader, the panel's warnings and switches, the preview's links, `canDelete`, `changedFields`), `survey-data.ts`, `team-data.ts` and `insights-data.ts`. The trigger editor (`TriggerBuilder.tsx`) takes the course's areas and action lessons from the page, read once (`readTriggerCatalog`), where it read them itself for every open row. Development pages: `/dev/admin/templates` (`?state=full|fixed|empty|loading|error|nosettings|nocourse`, `?role=founder|admin|csm`, `?drift=1`), `/dev/admin/survey` and `/dev/admin/team` (`?state=full|empty|loading|error`, the Team page also `?role=admin`) and `/dev/admin/insights` (`?state=full|partial|empty|loading|error|noreset`, `?course=new|old`; `noreset`, since the review's fix round, everything read but the switch's date), their data in `src/app/dev/admin/<page>-fixtures.ts`. Tests: `client-tests/templates-page.test.mjs` (71), `survey-page.test.mjs` (22), `team-page.test.mjs` (14) and `insights-page.test.mjs` (14); `template-on-off`, `admin-pages` and `csm-cutover` follow the new files and the one renamed label; `world-tests/admin-pages.mjs --only templates,survey,team,insights` draws the four pages in every state at 390x844, 1280x720 and 1440x900 and clicks through them (203 checks on 2026-10-20). With them, `npm run test:client` on 2026-10-20: 2882 checks in 61 suites, 0 failed. Since the render review's fix round (2026-10-21): the "how it's counted" folds of Insights, Outreach insights and Templates show the browser's open/close triangle (`FoldSummary`), Message settings' Show settings says open or closed (`aria-expanded`, `aria-controls`), the New template dialog's Create template is the ink button, the Survey's answers sit in their card under a hairline (a card inside the card before), the Survey's and Lesson feedback's names are the admin's name part (the reads take `discord_username` for it), Insights' Mean progress is in the primary ink, both insights' ranges stay on one line that scrolls on a phone, and every one of these pages says "Couldn't load" in its header when its read failed.

**Launch cohort only (v75.51):** every admin metric surface (dashboard, /admin/insights/progress, and /admin/not-activated, removed in the review's fix round of admin rebuild 2 and back as it was since its render review's fix round; until admin rebuild 2 also /admin/students and /admin/journey, which since then list every student with a first payment at any date, from 1 October (`DISCOUNT_ELIGIBLE_FROM`) since the owner's review of 2026-10-21, and the new program's students from 9 October, D8 and D9, both on the two $97 monthly plans alone since the owner's answer of 2026-10-21, `MONTHLY_97_PLAN_IDS`) filters to the LAUNCH COHORT — students whose `first_paid_at >= ADMIN_STUDENT_JOIN_CUTOFF` (2026-05-25). Pre-launch / legacy customers are excluded from operational surfaces. The rebuilt 30% page (admin rebuild) does not filter this way: it lists the 30% rule's own population (a first payment from 1 October, any plan). The previous "All members | New students" scope toggle (v75.13–v75.50) was removed because it produced inconsistent reads across surfaces and obscured the actual launch-retention signal. CSM crons and the day-28 DM also filter via their own (independent) day-30 sprint-window filter (`csmSprintWindowCutoffIso()`).

**The admin numbers on both courses (cutover WI-5, 2026-10-14, branch `world-engine`).** Every lesson count divides by the lessons with `counts_toward_progress` (64 on the old course, 140 on the new), read from `lessons`; a count that fails shows "—", never a fallback number. Area names, their order and the Journey chips' numerals come from `regions` (so before the switch the 4th chip reads "Gate of Possibilities" where it read "Gate"). A student's page names the gate lesson (`is_gate`) by its title; the old check of an id `l18` that does not exist is gone. The Journey drawer leaves out lessons that do not count, as the student page already did. Each page that shows pace reads `admin_config.curriculum_reset_at` (`loadCourseActivity` and `useJourneyPaceCounts` in `src/lib/useJourneyPaceCounts.ts`): with no row the pace pill is as before; with it the pill is activity (Not started, Moving, Slipping, Stalled, defined under [The course switch](#the-course-switch-cutover)), read from the view `student_last_counted_completion`, the "Region behind" pill on a student's page is gone and the page shows "In <area name>", and the activity counts on `/admin/journey` and the Insights card cover every active and past-due paying member of the launch cohort, Month 2+ included, with no day-30 cut. When the key cannot be read, pace and activity show "—". The trigger editor offers the areas from `regions` and every lesson with an action item by title, and after the switch it stops offering the three clock metrics. The "Day N" on the students list, a student's page, the Journey cards, the DM templates and the Journey's week columns still count from first payment after the switch (morning review P9), while a CSM task's "Day N" counts course days. Every page after the switch is unproved: it needs a team login (the PRD's ship order, step 12).

**Canceling state (v75.46–v75.47):** Whop emits a "Canceling" status when a student clicks cancel but still has access through the end of their billing cycle. The sync runner stamps `students.cancel_scheduled_at` for these students. The dashboard surfaces a "Canceling" early-warning tile; the journey kanban shows an amber pill on the student card. The M2 conversion helper (`isMonth2Converted`) counts Canceling students as NOT converted if the cancel was scheduled on/before the end of the first cycle.

**⚠️ Month 2 conversion produced NO usable reading before 2026-08-07. Do not cite any historical M2 figure.** Two separate defects ran back to back:

1. *Launch → 2026-08-06 (fixed in 8e9c9cd, v85.7).* The denominator called `isInMonth2Cohort` bare inside `.filter()`, so the array index landed in the helper's optional `asOfMs` param and the day-30 check compared a timestamp against `0, 1, 2…`. Denominator permanently 0, rate permanently null, card stuck on "Waiting on the first month-2 cohort." **through month 3.**
2. *2026-08-06 → 2026-08-07 (fixed in 71ba058, v85.8).* With the denominator restored the card printed **98%** — a tautology. `canceled_at` is an access-END/observation stamp, and on a monthly plan access always ends AT the cycle boundary, so `canceled_at > first_paid_at + 30d` was true for every ordinary non-renewal. 133 of 144 churned students scored as retained. Corrected to cycle-end + 7d grace: **284/291 = 98% → 140/247 = 57%**, verified against production counts.

Both failed into *plausible* states rather than errors, and in both cases a stale code comment vouched for the wrong behaviour — which is why neither was caught for months. Before trusting any metric here, check whether its value has ever actually moved. The full derivation, the calibration histogram, and the arity warning live in the `RENEWAL_GRACE_MS` docstring in `src/lib/admin/metrics-definitions.ts` — read it before editing either helper.

**M2 is a PROXY, permanently, until a payment signal exists.** No payments/invoices/transactions table exists in the schema; conversion is inferred from access surviving the renewal point. Win-backs (`canceled_at` is cleared on reactivation) and `past_due` students mid-dunning both still read as converted. The real signal is Whop's `renewal_period_start` — it is declared at `src/types/whop.ts:32` but MISSING from `WhopMembershipRow` (`src/lib/whop-members.ts`), so TypeScript erases it from every sync read and it has been silently discarded since launch. Identical class to the `cancel_at_period_end` miss fixed in v75.46. Adding it (plus a `students.current_period_start` column) turns M2 from an inference into an observation.

## API Routes

**Auth**
- `POST /api/auth/whop/authorize` — start OAuth + PKCE
- `GET /api/auth/whop/callback` — complete OAuth, upsert student.
  While `STUDENT_APP_CLOSED=true` it refuses unlisted Whop ids before
  any write, and logs each refused id under `[whop-callback]` (see
  "The closed doors before the new course"). Since 2026-10-17 (T-079
  review) a Whop sync still running when the 2.5 s timer wins is handed
  to Next's `after()` (`waitUntil` on Vercel), so the rows it adds,
  their streak day and the badges are written after the redirect. If
  `after()` throws (no `waitUntil` on the platform), the login goes on
  as before and logs `[callback] after() unavailable`.
- `GET /api/auth/me` — current session; for a student the app is
  closed to, the answer adds `appClosed: true`
- `POST /api/auth/team/login` — admin password login

**Student mutations** (Bearer token, RLS-respecting)
- While `STUDENT_APP_CLOSED=true` (T-078), every route here,
  `lesson-video` and `lesson-watched` included, and the two student
  discount writes answer 503 `student_app_closed` right after the token
  check, unless the student's Whop id is in `STUDENT_APP_OPEN_FOR`
  (`refuseWhileClosed`).
- `POST /api/student/toggle-lesson`: tick or untick a completion on the
  student's own say-so, for lessons that are not `watch` lessons. Since
  v93 it answers 400 ("Watch lessons complete themselves.") when the
  lesson's `type` in the live `lessons` table is `watch`. If that lookup
  errors it lets the request through. Since 2026-10-17 (T-079) a tick
  counts as a streak day only when the lesson has no action half,
  because then the row finishes it. An untick never counts. On the new
  course's catalog (`CATALOG_IS_V2`) a lesson with an action half is
  refused with 400 "Complete this action item on its lesson page.": its
  untick deleted the row and its saved link, so completing it again
  counted a day, and the new app never calls this route. Last active
  moves on every tick and untick that goes through, as before.
- `POST /api/student/lesson-video`: body `{ lessonId }`. Gives one
  lesson's Tella embed address to an active member, as `{ embedUrl,
  durationSeconds }`. It is the only place a video's address leaves the
  server, and it replaced `POST /api/student/video-token` on
  2026-10-12. It answers 401 without a session token or with a bad
  one, and 400 when the body cannot be read or has no `lessonId`. Then
  it checks, in this order: the caller's student row (404),
  `students.membership_status` (403 unless it is `active`), the lesson
  in the catalog the switch names (404), and that the lesson is a
  `watch` lesson with a row in `lesson_videos` (404 with
  `notRecorded: true`, the normal answer for a lesson not filmed yet).
  It answers 500 when the `lesson_videos` read itself fails, so a
  missing table does not pass for "not recorded". The answer carries
  `Cache-Control: no-store` and is never cached, because a cached
  address would outlive the membership check that released it. It
  reads no environment value beyond the Supabase ones and never logs a
  video id. It has never been called against a database.
- `POST /api/student/lesson-watched`: body `{ lessonId }` and nothing
  else. The server re-reads `student_lesson_watch` and decides against
  the catalog's `duration_seconds`: the furthest position must have
  reached 95% of it (or the row already carries `threshold_met_at`),
  and the played seconds must reach the floor (`WATCH_PLAYED_FLOOR`,
  default 0.8). A lesson with no `duration_seconds` is never complete.
  400 when the lesson is not a `watch` lesson. On a yes it stamps
  `student_lesson_completions.completed_at` and runs the streak, CSM
  reactivation, achievements and task re-evaluation chain, then
  answers `{ completed: true, newAchievements }`. On a no it answers
  `{ completed: false, reason, positionRatio, playedRatio, playedFloor }`.
  Calling it again on a finished lesson writes nothing, which the
  player relies on: since 2026-10-12 it asks again on later heartbeats
  until the answer is yes. It makes no membership check; the paywall is
  on `lesson-video`.
- `POST /api/student/mark-action-shipped` — toggle `action_completed_at`; reads the lesson from the active catalog, and on the v2 catalog an action item with no video half (a setup lesson) gets `completed_at` too (`src/lib/world/action-items.ts`, `actionWrite`). A foreign key failure (a new-course lesson before the cutover) answers 409 with plain words. Since 2026-10-16, on the v2 catalog it completes an action item only once its Discord link is saved on the row: with none it answers 400 "Paste the link to your Discord message first." and writes nothing (`PASTE_LINK_FIRST` in `action-items.ts`, the sentence the lesson page shows too). A failed read of the row answers 500, never "paste the link". The old catalog behaves as before, and its undo needs no link. Since 2026-10-17 (T-079) the press that turns the action half from open to done is a streak day on both courses, whether or not the video is watched. A second press is not. On the new course's catalog an undo (`shipped: false`) is refused with 400 "A completed action item can't be undone.": the lesson page has no undo, and an undo followed by a press counted a day. The old course keeps its undo, which is no streak day. Last active moves only when the press leaves both halves done, as before. Since 2026-10-22 (branch `night/action-done`) the seven action items finished with Done alone (`isDoneOnly` in `action-items.ts`: the four of AI Ads + Content, `a5l08`, `a5l12` and `a5l22`) complete with no link saved: their page's Done button calls this route, and the write, the streak day, last active, the CSM hooks, the badges and the task re-evaluation are the same as for a hand-in. On `a5l08` and `a5l12` (each with a video) the write is the action half alone, as for any watch lesson (`actionWrite`): the streak day is the action's (T-079), last active waits for both halves, and the video's half comes only from `lesson-watched` or from Whop. A link already on their row is kept, a link sent in the body is never read (the route reads `lessonId` and `shipped` alone), a failed read of the row still answers 500 and an undo is still refused. Each of the other three (`a3l17`, `a3l25`, `a5l23`) still answers 400 `PASTE_LINK_FIRST` with no link saved
- `POST /api/student/skip-lesson` — mark optional lesson skipped. It refuses action items, and since 2026-10-16 on the v2 catalog it also refuses plain `watch` lessons: 400 "This lesson can't be skipped. Watch it to complete it." (a skip counts as done, so it finished any lesson in one request). Nothing on the map calls it
- `POST /api/student/save-action-link` — Discord submission URL, checked by `checkDiscordLink` (`src/lib/world/action-items.ts`); reads the lesson from the active catalog; a foreign key failure answers 409 with plain words. Unchanged on 2026-10-22: a link sent for one of the seven Done-only action items is stored as before, though their page has no field and never sends one, and nothing shows it
- `POST /api/student/rate-lesson` (admin rebuild 2, WI-7, D10; branch `night/a2-feedback`): body `{ lessonId, stars, comment? }`, the student's rating of one lesson, upserted on student and lesson, answered `{ rating: { lesson_id, stars, comment, created_at, updated_at } }`. The rules are `src/lib/world/lesson-rating.ts`, which the lesson page shows its block by: the lesson is in `lessons` (404 "That lesson isn't in the course."), a video lesson (400 "Only video lessons can be rated.") that is not the Ad Bounty lesson (400), finished as the map counts it, the video watched and the lesson done, so an action item's hand-in too (403 "Finish this lesson first, then rate it."); stars whole from 1 to 5 and a comment of at most 1000 characters once trimmed, each refused in words, never rounded or cut. A failed read or save is a 500 in plain words, the database's own words in the log only. Since v110 it is the only writer of `student_lesson_ratings`.
- `POST /api/student/submit-quiz` — quiz attempt. Since 2026-10-17 (T-079) it ticks no streak; last active still moves.
- `POST /api/student/dismiss-playbook-welcome` — Map 2 intro (v2)
- `POST /api/student/celebration-seen` — dismiss celebration overlays
- `POST /api/student/complete-onboarding` — finish first-time onboarding
- `POST /api/student/mark-dashboard-login` — stamp first /dashboard load (v51)
- `POST /api/student/mark-intro-video-threshold` — intro video watched end-to-end (v51; v72.5/72.6 dropped the ~65% threshold for a full-`ended` requirement, column name kept for back-compat)
- `POST /api/student/dismiss-why-youre-here` — final WYH card dismissed (v51)
- `POST /api/student/submit-region-quiz` — region-quiz attempt (v65). One round-trip per completed attempt: updates last/best score, increments attempts, stamps `quiz_passed_at` on first attempt at ≥ 50%. Replaces v54's mark-region-quiz-passed + increment-region-quiz-attempts split.
- `POST /api/student/refresh-watch-sync` — force a Whop watch-history pull. Since 2026-10-16 its `syncedCount` is the rows the pull added (new lessons, and skips or saved-link rows it finished), and the streak and "last active" move only when that is above 0; a failed lessons read answers 500. Since 2026-10-22 (branch `night/action-done`) the pull (`syncWatchProgress` in `src/app/api/student/_lib/watch-sync.ts`, which the login runs too, step 3c) gives each of the seven action items finished with Done alone (`isDoneOnly`) that Whop lists as finished its action half where the row has none: a row it added or finished, and a row a Whop writer left with the watch half alone before the item was on the list. A row whose action half is in (Done pressed on `a5l08` or `a5l12` before its video) keeps it, and the pull writes a lesson's watch half only when Whop lists that lesson, as for every lesson. The half is dated at Whop's own time for the lesson (`whopActionTime` in `action-items.ts`: the interaction's `created_at`, the earliest if Whop lists the lesson twice, else the row's `completed_at`), never at the pull's time, so Triple Threat counts such a row on no day, as every row a pull brings in. A half written on an older row is not counted in `syncedCount`. A failed read of those rows or a failed write is an error on the sync row and a 500, as the promotion's is; the next pull fills it
- `GET  /api/student/data` — full snapshot for the dashboard and for
  `/world`. It reads the catalog through the switch in
  `src/lib/catalog-tables.ts` and returns `watchProgress` (the
  student's `student_lesson_watch` rows) and `catalogSuffix` with it.
  Since 2026-10-12 every lesson it returns carries `has_video`: true
  when the lesson has a row in `lesson_videos`. It never returns a
  video id. This route has no membership check, so an id in its payload
  would reach every account that is signed in, lapsed members included.
  Since 2026-10-17 its `discountRequest` carries only `id`, `status`,
  `created_at` and `rejection_reason`, never the Whop promo code (the
  Field Journal reads only `status`, for the same reason).
  When the `lesson_videos` read fails, as it will on a database v100
  has not been applied to, it logs one error per request, every
  lesson gets `has_video: false`, and the answer says so in
  `lessonVideosFailed: true`; a refresh then keeps the `has_video`
  the map already had (2026-10-20). Since 2026-10-17 (T-079) its
  `streaks.current_streak` is the streak as it stands today: 0 once
  `last_streak_date` is before yesterday (UTC), from
  `currentStreakAsOf` in `src/lib/streak.ts`. The stored row is left
  alone; the next counted day restarts it at 1. Since 2026-10-20 it
  answers 500 (`{ error: "Could not load your data. Try again." }`)
  when the read of the regions, the lessons, or the student's
  completions, streak, milestones or discount request fails (no
  request at all, `PGRST116`, is not a failure), and the server log
  names the read; it used to answer 200 with the failed part empty.
  `StudentContext` then applies nothing (system_contracts.md, "a
  failed read").

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
  `/api/admin/backfill-discord-ids`, `/api/admin/backfill-first-paid-at` v75.34
  (since 2026-10-20 it fills an empty `first_paid_at` from the first real
  payment; its answer counts `no_payment`. The students go in id order, no
  student is started after 240 s and no Whop read waited on past 280 s, and
  the answer gives `checked`, `remaining` and `next_after`: call again
  with `{"after": <next_after>}` until `remaining` is 0, since the free
  members stay NULL and a pass started over reads them all again),
  `/api/admin/refresh-everything` v75.22)
- `POST /api/admin/whop-catchup` (T-089, 2026-10-20): one pull of every
  active member's finished Whop lessons into the app, for the members
  who watch on Whop and have not opened the app since the switch.
  Founder or admin session, or `CRON_SECRET` from a terminal (as
  `backfill-achievements`); `maxDuration = 300`, and no member is
  started after 240 s. Body `{"mode": "snapshot" | "dry" | "write",
  "after": null | "<cursor>"}`. `snapshot` makes no Whop request and
  answers, for every member, the rows the write can change (completions
  without the Discord link, sync rows without the tokens and with the
  Whop ids in an old error hidden, streak rows), to save in `bulk_ops/`
  before the write; `dry` reads and counts; `write` writes and answers
  its change log. Members are active or past_due, the CSM pool first;
  `this_call.next_after` is the cursor for the next call, until
  `remaining` is 0. A new row carries Whop's `created_at` (when the
  member opened the lesson there; Whop keeps no finish time), a later or
  missing one replaced by the run's clock and counted; a row with no
  `completed_at` is finished the same way; a row with a time keeps it.
  Since 2026-10-22 (branch `night/action-done`) a row of the seven
  action items finished with Done alone (`isDoneOnly`) gets the action
  half as well where it has none: at the watch half's time on a row the
  run adds or finishes, and at Whop's time (`whopActionTime`) on a row
  that holds the watch half alone (a Whop writer's from before the item
  was on the list); such a half alone adds no row and ticks no streak.
  A row it finishes whose action half is in (Done pressed on `a5l08` or
  `a5l12` before the video) keeps it and gets the watch half alone, and
  a finish that carries the action half asks for an empty one, so a Done
  pressed after the run's read is never written over (that row waits
  for the next pass). The answer counts them in `rows.actions_finished`
  (dry: `would_finish_actions`), the change log lists each as
  `actions_finished: [row id, action_completed_at]`, and the snapshot
  carries `action_completed_at`, so the undo also clears each half the
  run wrote where it still holds that time, and never one the student
  pressed. The catch-up of 2026-10-20 had written 293 rows of the seven,
  for 112 members, with the watch half alone: 195 of the four of
  AI Ads + Content for 91 members and 98 of `a5l08`, `a5l12` and
  `a5l22` for 53 (counted on 2026-10-22 from its change logs and its
  snapshot in the workspace's `bulk_ops/`). A pass of this version
  fills those still without it for the members it reads (active or
  past_due), and so does each member's next login or visit.
  The sync row is written as the backfill writes it. The streak ticks
  only for a lesson added now that Whop says was opened today (UTC), and
  only when the member's streak does not count today yet (it reads
  `last_streak_date` first, so `streak_ticked` and its change log leave
  out a member whose day already counted); no
  "last active", badge, "came back" check, CSM task check or Discord
  post. Refuses 400 (mode, cursor), 500 (no `WHOP_API_KEY` or
  `WHOP_COURSE_ID`), 409 before the switch. Stops with `ok: false` (500)
  when Whop ignores the member filter, after 5 failures of one kind in a
  row, or when 25 members with finished Whop lessons match no lesson
  (`WHOP_COURSE_ID` names another course); once the cause is fixed,
  that pass starts again from the beginning. A 429 is waited out
  (Whop's seconds or 15, at most 30) and retried twice, then the call
  ends with the cursor before that member, as it does at once when the
  wait would end past 240 s. A Whop read still unanswered 285 s into a
  call is given up (`CATCHUP_READ_LIMIT_MS`) and the call ends the same
  way, so it answers before Vercel's 300 s with its change log and its
  cursor. At most 4 Whop requests a second.
  Answers count failures by kind and never name a member, an email, a
  Whop id or the course. The run is `src/lib/whop-catchup.ts`, the check
  afterwards `supabase/diagnostics/whop-catchup-proof.sql`, the design
  `_admin/prds/night-2026-10-19/whop_catchup.md` in the workspace.
- `POST /api/admin/first-paid-repair` (the first-paid fix, 2026-10-20):
  sets every student's `first_paid_at` to their first real Whop payment,
  once. The live writers only fill an empty value, so a free membership's
  date stored before the fix is corrected here and nowhere else. Founder
  or admin session, or `CRON_SECRET` from a terminal (both sides
  trimmed); `maxDuration = 300`; pinned to `iad1`, next to Whop, by its
  entry in `vercel.json` since the merge into `world-engine`
  ([Where the functions run](#where-the-functions-run-deploy-regions)).
  Body `{"mode": "dry" | "snapshot" |
  "write", "lanes": 1 | 4}`, one call per pass. It walks every paid
  payment of the account once (`walkFirstPayments`, 4 requests a second,
  `Api-Version-Date: 2026-10-15-1`), no page started after 240 s and none
  waited on past 285 s; a walk that does not finish answers 500, `ok:
  false`, kind `walk_incomplete`, and writes nothing, with its pages and
  Whop's time per page (`walk.ms_per_page`) so it says how far off it
  was. `lanes` is 1 when left out (one chain of pages); `"lanes": 4`
  reads the history in 4 stretches by `created_at` (split at 1 December
  2025, 1 April 2026 and 15 July 2026, each a second wider either side)
  side by side inside the same 4 requests a second, for when one chain
  runs out of time. Whop's `created_after` and `created_before` are
  documented but have never been called from here: a lane given a
  payment outside its stretch stops the walk (`filter_ignored`), and a
  400 does too (`http_other`); either answer says to run it with
  `"lanes": 1`. A page whose rows have no buyer on any of them, or no
  total that reads on any of them, stops the walk as `bad_page` (Whop
  answered in a shape this code does not read). Then every student
  with a `whop_user_id`, compared as times: a first payment at another
  time is changed, the same time is left, and a student with no payment
  (a free member, a seat, a comp) is counted and left as is, never
  emptied. `dry` answers counts: `students` (with a payment, unchanged,
  to change, no payment with a date or empty), `moves` (later, earlier,
  from empty; under a minute, a day or more) and `thirty` (the 30%
  opening for a date before 1 October or an empty one, closing, the
  9 October launch crossed either way; `requests_change`, students with
  a 30% request that starts or stops counting; and
  `open_with_old_request`, students the new date opens the 30% to while
  they hold a pending, approved or applied request that does not count
  under it, so the map can offer them Apply again), and
  `thirty_students`, the student ids behind `opens_was_before_oct_1`,
  `opens_was_empty` and `open_with_old_request`, to check a few in
  Whop's dashboard before the write. `snapshot` answers
  `[student id, first_paid_at, new_first_paid_at]` for every row the
  write would change, to save in `bulk_ops/` before it. `write` writes
  each change only while the row holds the value read (`.eq` on it, or
  `.is` null), 8 at a time, none started after 280 s (kind `write_incomplete`; the next write
  finishes it), and answers its change log `[student id, old, new]`; a
  row changed meanwhile is counted (`changed_meanwhile`) and left, and a
  second write changes 0. Refuses 400 (mode, lanes) and 500 (no
  `WHOP_API_KEY`). No answer names a student, an email or a Whop id.
  After a deploy the dry run comes first, and passes when
  `walk.payments.kept` is above 0, `skipped.no_user` and
  `skipped.bad_total` are about 0 (the payments came back in the shape
  read) and `walk.payments.oldest_kept_paid_at` is about February 2025,
  the account's first month of sales (the list was read to its end);
  `skipped.dispute_lost` says how many charged-back payments the rule
  leaves out. The run is `src/lib/first-paid-repair.ts`, the check
  `supabase/diagnostics/first-paid-repair-proof.sql`, the facts behind it
  `_admin/prds/first-paid-fix/` in the workspace.
- `GET /api/admin/lesson-feedback` (admin rebuild 2, WI-7; branch
  `night/a2-feedback`): founders and admins (`requireTeam`; a csm gets
  403). Everything `/admin/feedback/lessons` shows in one answer:
  `loadLessonFeedback` reads the switch's moment, `regions`, `lessons`
  and the ratings made since it (paged past 1000 rows), and the raters'
  names in batches of 100; `buildLessonFeedback` groups them by area and
  lesson (`src/lib/admin/lesson-feedback.ts`). Any failed read is a 500
  "Couldn't read the lesson ratings, so nothing is shown. Try again." with
  `failed`. Writes nothing. Contract in `system_contracts.md` ("Lesson
  ratings").
- `GET /api/admin/cutover-status` (cutover WI-10): founder and admin
  only (`requireTeam`, bearer token, so it is read through
  `/admin/cutover`). Answers `{ ok, phase: "before" | "after",
  problems, build, db }`, `Cache-Control: no-store`. `build` is the
  answering deployment's own values (`STUDENT_HOME`, `WORLD_IS_LIVE`,
  `CATALOG_IS_V2`, `LESSONS_TABLE`, the suffix, whether
  `WHOP_COURSE_ID` is set and its last 4 characters when it is longer
  than 8, `VERCEL_DEPLOYMENT_ID`, the commit); `db` is the switch's
  moment, the ids in `regions` and three counts of `lessons`. A read
  that fails answers 500 with the reason, never a guessed number.
  `PUT /api/admin/config` refuses the key `curriculum_reset_at` (400).
- `GET /api/admin/config` (any team role) lists every `admin_config` row;
  `PUT /api/admin/config` (founder and admin) writes one row, and since
  admin rebuild 2 (D6) only the 6 keys of `src/lib/admin/config-keys.ts`:
  `program_login_link`, `discord_invite_link`, `dms_master_enabled`,
  `day28_dm_enabled`, `engagement_alerts_enabled`,
  `csm_task_summary_enabled`, a switch only as "true" or "false". Any
  other key, a value that is not text or a switch set to anything else is
  a 400 in plain words with nothing written; a key with no row is a 404, a
  failed write a 500 ("Couldn't save the setting. Try again."). It records
  `updated_by` from the login. Proven in `client-tests/admin-routes.test.mjs`.
- The ads tick (`/api/admin/verify-ad-submissions`), from the student
  page and the journey drawer: sets `students.ad_submissions_verified`.
  Since 2026-10-20 it gates nothing: the approve route no longer reads it
  (Lovro's decision), and both checkboxes' help text says "Approving the
  30% no longer needs it."
- The admin rebuild's routes (branch `night/admin`, 2026-10-20, not on
  production), any team role, bearer token, every error a plain
  sentence; full contract in `system_contracts.md` ("Admin routes of
  the rebuild"):
  - `GET /api/admin/thirty`: the 30% page in one answer
    (`loadThirtyData`, `buildThirtyView`): every request made from 1
    October, oldest first, with the student, the stored coupon
    (`student_membership_discounts`) and, on each pending request, the
    approve route's verdict, the coupon first (admin rebuild 2, D4 and
    D5). Writes nothing. A failed read of the coupons is `couponsUnread`,
    never a 500.
  - `POST /api/admin/thirty/check-coupon` (admin rebuild 2, the render
    review's second round, 2026-10-21): "Check Whop again" on a pending
    row whose stored coupon refuses it. Body `{ requestId }`; a pending
    request only (409 otherwise, 404 when it is gone). Asks Whop now for
    that student through `checkMembershipDiscount`, which stores the
    answer; 200 `{ discounted, code }` only when Whop's answer was
    stored, 502 when Whop gave no answer, 422 when the student has no
    Whop user on file (never on production: the column is NOT NULL), 500
    when the request, the student or the write failed or the deployment
    has no Whop key or no course product in `WHOP_PRODUCT_ID`. Since T-122
    (2026-10-21, branch `night/admin3`) a Whop id on file that is missing,
    a payment's or one Whop does not know is asked through the student's
    Whop user, where it was a 422; since its second fix round the
    student's real course payments are judged too whenever the
    memberships show no discount; since its third (2026-10-22) by the
    owner's rule as he put it: a code other than the student's own 30% on
    the membership on file, on any course membership found through the
    Whop user or on any course payment is a coupon, then the price (the
    next paragraph but one); since its fourth the memberships that no
    longer grant access are read for a code too, and the price is that of
    the first real course payment alone; since its fifth a payment naming
    no code that came to less than its subtotal is a coupon too, and the
    row it stores carries the rule's stamp. Makes no Whop code and changes
    no request. Proven in `client-tests/membership-discount.test.mjs`.
  Today's `GET /api/admin/today` and `POST`/`DELETE /api/admin/today/mark`,
  Stats' and Brand Owners' routes, `/api/admin/dm-toggles` and
  `/api/admin/preview-day28-dm` were removed in admin rebuild 2 (D2; see
  "Removed in admin rebuild 2" under Admin Surfaces).
- v75.38 + v75.45: `/api/admin/kpis` and `/api/admin/insights/progress` routes deleted (the M2 helper centralized + insights now fetches snapshots client-direct)

**Discounts** (all require auth post-v75.31)
- `POST /api/discounts/request` — student-self auth; opens flow
- `POST /api/discounts/submit-feedback` — student-self auth; 6-question form
- **The survey is enforced on the server (the owner's review, 2026-10-21; branch `night/admin3`, not on production).** Before anything is written, both routes read the active questions marked `is_required` and refuse an application that leaves one unanswered, by the forms' own rule (a number for a scale, a choice, words that are not only spaces; `requiredAnswersRefusal` and `unansweredRequired` in `src/lib/discount-feedback.ts`): 400 `{ error: "Answer every question that is not marked Optional, then send it again." }`, the questions' ids in the server log only. A plain `request` carries no answers, so it is refused while a required question is active (the map sends one only when it finds no question). A read of the questions that fails is a 503, "We couldn't check your answers just now, so nothing was sent. Try again in a minute.", never "no questions". Until then only the forms asked for the answers.
- `POST /api/discounts/approve` — team auth (founder/admin/csm); creates Whop promo. No ads check since 2026-10-20 (the owner: the 30% already asks for 61 videos): the course's rule alone decides, and Generate anyway (`override`) skips it. Before, it refused while `students.ad_submissions_verified` was false. Since the owner's review (2026-10-21; branch `night/admin3`) a refusal of the rule or of a read it needs carries `code: "rule"` (the old course's 409 "The course changed and this check cannot run. Nothing was approved." among them), so the 30% page offers Approve anyway on it; `overrideCoupon` skips the coupon check (below); and `override` or `overrideCoupon` from a csm is refused with 403 "Only a founder or an admin can approve past a check." before anything is read (until then any team member could send `override`). The log line names what was skipped ("Eligibility gates skipped.", "The coupon check skipped."). Since T-122's fourth fix round (2026-10-22) a coupon check that gives no answer (Whop gives none and no stored row answers) refuses the normal Approve once the rule has had its say: 503 with code `rule` and the reason in the team's words (`couponUncheckedApprovalRefusal` in `discount-server.ts`; "Whop gave no answer to the coupon check, so nothing was approved. Try again in a minute." when Whop gave none), so a founder or an admin gets Approve anyway on it, whose log line adds "The coupon check gave no answer."; until then the approval went on and made the code.
- `POST /api/discounts/reject` — team auth
- `POST /api/discounts/mark-applied` — team auth
- **The coupon (admin rebuild 2, D5, branch `night/a2-thirty`, needs v111 for its stored half; v111 is on production, where the cron of the rule before T-122 has written its rows every 2 hours since 2026-10-21 11:37).** A student who already has a coupon cannot get the 30%: since T-122's third fix round (2026-10-22) by the owner's rule as he put it (the next paragraph: a promo code other than the student's own 30% on any course membership or course payment, since the fifth a payment naming no code that came to less than its subtotal, then a price under 97.00); until then a promo code still discounting the next renewal (`renewal_price` below the plan's renewal price, read from Whop v1 pinned to `2026-10-15-1`; the forever 10% `evolve10` renews at 87.30 on the 97.00 plan, a used one-month code keeps its id and renews at 97.00, which read as none). On the new course `request` and `submit-feedback`, once the rule grants, ask Whop (`checkMembershipDiscount` in `src/lib/membership-discount.ts`; since T-122 the membership on file, else every course membership found through the student's Whop user, and since its second fix round every real course payment whenever those show no discount: the next paragraph), fall back to the stored row for that membership when Whop does not answer (a stored coupon always; since the third fix round a stored no coupon only when that round's rule wrote it, its `source` set, which needs v113, since the fourth only naming no code or the student's own 30% by the promo id on their own request, and since the fifth only with this rule's stamp from one write, its `source` carrying the rule's version and its `source_checked_at` its `checked_at`, and only when the student's own row could be read: the next paragraph), and with neither, since the owner's review of 2026-10-21 (branch `night/admin3`, not on production: applying fails closed), write nothing and answer 503 `{ error: "We couldn't check your membership just now. Try again in a minute.", state: "read-failed" }` (`membershipUncheckedRefusal` in `discount-server.ts`; until then the request went through and the approve route checked again). Neither means, since T-122, Whop not answering (no connection, a 5xx, a 429 after its two retries, no answer within the 6 and 8 seconds) or refusing the key, payments (and since T-122's fourth fix round the user's list of memberships, or a membership read) Whop answered in a way the check cannot judge, no Whop key or no course product on the deployment, or a student row that could not be read. Until T-122 it also meant no Whop membership on file, a payment's id where the membership's belongs, or a membership with no plan or renewal price, so such a student could not apply at all. A refusal of the coupon itself is 400 `{ error: "You can't apply for this discount because you already have a discount applied to your account.", state: "not-eligible" }` with nothing written. A live answer is stored, best effort, so the map catches up at its next load. `GET /api/student/data` carries the stored flag (`membershipDiscounted`, never the code or the prices), and the map's panel then shows that line with no Apply and the word "Closed" (`discountState` reason `has-discount`). `approve` first asks the same of the student's membership, on either course and with `override` too, and refuses with 400 `{ error: "This student already has a discount on their membership (evolve10).", code: "has-discount" }` before any Whop code is made, unless a founder or an admin sends `overrideCoupon` (Approve anyway on the coupon's row, since the owner's review), when Whop is not asked at all. When the check gives no answer, since T-122's fourth fix round the normal Approve is refused too (503, code `rule`), and Approve anyway goes on. The cron `GET /api/cron/refresh-membership-discounts` fills the stored rows every 2 hours (the open windows, and since the render review's second round every student holding a pending request whatever their window), and "Check Whop again" on the 30% page (`POST /api/admin/thirty/check-coupon`) fills one student's when the team asks. **Not checked live:** the plan read the rule needs (`GET /api/v1/plans/{id}` pinned to `2026-10-15-1`, its `renewal_price`; the PRD's validation 6) has only met the tests' stand-in Whop, written to the same assumption. Until T-122, if the field was missing or named otherwise, every read failed (`no_plan_price`) and the cron stored nothing (since T-122 a plan that does not read leaves the student to the codes and the payments, since its third fix round it decides no coupon at all, and since its fourth it is read only for a membership naming a code): until the owner's review the request and approve routes let everyone through by design and only the cron's 500 in `cron_runs` said so; since it, the request routes refuse every application whose membership has no stored answer ("We couldn't check your membership just now."), since T-122's fourth fix round the normal Approve refuses too (Approve anyway goes on), and the routes' log lines say why ("nothing written, the coupon check could not run (no_plan_price) and nothing is stored"). The first dry run on production (2026-10-21 at 11:37, read only, before T-122) checked 244 of 290, found 33 with a discount and could not read 46 (22 `not_a_membership`, 24 `bad_shape`), which is what T-122 answers. **An open reading for the owner:** D5 named the renewal price alone. A membership renewing under the plan's price with no promo id (a retention offer, a price set by hand) is no coupon on the membership; since T-122's third fix round its payments refuse it when they come in under 97.00 in dollars naming no code (the price, step 3), and otherwise it gets the 30% on top. `membership-discount.test.mjs` pins that reading.
- **Every student a yes or a no (T-122, 2026-10-21, branch `night/admin3`, not on production; v113 for its record).** The owner's rule: "they should not be able to apply for the code if they have a coupon already ... If they paid less than 97, most likely they have a coupon. I don't want to even let them apply for the discount if they have a code already." Within the 30% window a student has made one course payment, rarely two. `judgeStudentDiscount` in `src/lib/membership-discount.ts` says it, and every route and the cron use it through `checkMembershipDiscount` and `refreshMembershipDiscounts`. Since T-122's third fix round (2026-10-22) it reads in this order, the codes first and the price second, the first coupon answering: (1) **a code on a membership**: any course membership the check reads that names a promo code other than this student's own 30% code is a coupon, whatever its renewal price and whether its price or plan reads; first the membership on file (source `membership`; an id that is not a membership's, or one Whop does not know, a 404 or another 4xx for that id, is passed over), then every course membership of the student found through their Whop user, read whatever the one on file said (source `user`, the row naming the membership that carries the code): those that grant access, active before past due, then the newest, and since T-122's fourth fix round (2026-10-22) those that no longer do (canceled, expired), the newest first, read for their code alone and never settled on (since the fifth all at once), so a 100% first month on a canceled membership, the student back at 97.00 on a new one, is a coupon; since the fifth fix round a membership of another product (its `product_id`, which Whop's schema requires, not one of the course's; the webhook stores any product's membership on file) is passed over like one Whop does not know, so that product's own code never refuses a course student, and with no course product named in `WHOP_PRODUCT_ID` nothing is read (`no_course_product`); (2) **a code on a payment, or a discount one shows**: any course payment of the student that names a promo code other than this student's own 30% code is a coupon, whatever its totals and whether they read, the $0 ones too (source `payment`, the row naming that payment's membership and its code), and since the fifth fix round so is any course payment naming no code whose price (the total less a tax added on top, as the price computes it) is below its subtotal, Whop's "price before discounts" (`discountWithoutCode`: a 0.00 checkout of a 97.00 subtotal, 873.00 of 970.00, EUR 44.95 of 89.90; in its own currency, real or not, refunded or not; a `subscription_update` charge excepted; the student's own 30% is named on its payment, so it stays no coupon), until then judged by the price alone; a payment row naming no buyer is read for a code or such a discount since the fifth fix round (it was skipped), never for its price; (3) **the price**, only when no code or discount shows anywhere, and since the fourth fix round of the student's first real course payment alone, "if they paid less than 97" (`firstRealPayment`: among the real payments naming their buyer, those at the moment `students.first_paid_at` names, else those at the earliest moment the list gives, in whatever order it comes; since the fifth fix round the checkout among them, `billing_reason` `subscription_create`, else the highest price, where the first listed was taken, so a 10.00 add-on listed before the 97.00 checkout refused): a real payment (paid, above 0, not refunded or lost in a dispute) naming no code is a coupon when its price is under 97.00 (source `payment`), the price being its total less a tax added on top (`tax_behavior` exactly `exclusive`; with any other behaviour, or none, the total stands); the price judges it only in dollars (codes alone judge another currency, and its `usd_total` is not read) and when its `billing_reason` is not `subscription_update` (a change to the subscription). A later charge never refuses a student by its price: a manual charge, an add-on (`one_time`), a plan change's 12.34 after a 97.00 (until the fourth fix round the price judged every real course payment, so a 10.00 manual charge or a 47.00 add-on after a 97.00 first payment refused a student who came in at full price). **This student's own 30% code** is never a coupon (`isOwnThirtyCode`): the Whop promo id stored on their own approved or applied request (`checkMembershipDiscount` reads those requests; a read that fails gives none, logged, so no code is then theirs; the cron leaves out every student holding such a request), or, since the fourth fix round only while they hold such a request, a code named, the case not minded, exactly as the approve route names this student's (`teamThirtyCodeFor`, which the approve route builds its code with: `ECOM30-` and the first 6 characters of the student's id, upper-cased), since two students' ids can share their first 6 characters (until then the name counted with no request). Any other ECOM30 code is a coupon: a public code named ECOM30, one named Ecom30Friends, another student's ECOM30-ABC123, or an ECOM30-5A1B2C made for another student whose id starts with the same 6 characters, used at checkout. A code whose name cannot be read is the student's own by its promo id alone. `/^ECOM30/i` stays for the 30% page's display alone (`isThirtyCode` in `thirty-view.ts`). With no coupon, the membership the check settled on answers with its own source (the one on file when it renews above 0, else the first found through the user that does, else the first found there that renews at 0; since the fourth fix round paid or free is each membership's own renewal price, with no plan read, where a plan that renewed above 0 came first until then), else the first real payment with no coupon (source `payment`; the newest until the fourth fix round), and no real course payment at all is none. The reads, 4 a second, the v1 ones pinned to `2026-10-15-1`: the membership on file (`GET /api/v1/memberships/{id}`); then, at the same time since the fourth fix round (one after the other until then), v2's `GET /api/v2/memberships?user_id=` (at most 4 pages of 50, every row's user checked; the course is what `WHOP_PRODUCT_ID` names less ETfB and Apex, `courseProductIds`, `whop-products.ts`) and the payments (`fetchCoursePayments` in `src/lib/first-payment.ts`, which replaced `fetchRealCoursePayments`: `GET /api/v1/payments?user_id=&status=paid&first=100`, every page, every row's user checked, every course payment the list gives with whether it is a real payment, its code, its subtotal, the tax its total carries on top, its currency and its billing reason); then the memberships the list names, those that grant access one after the other and since the fifth fix round those that no longer do all at once (one after the other until then); and for a membership naming a code its plan's renewal price (`GET /api/v1/plans/{id}`, once per plan per run; since the fourth fix round never for a membership naming no code, where it decides nothing) and the code's name (`GET /api/v1/promo_codes/{id}`, once per code per run). The $0 payments: Whop's changelog entry 2026-09-02-1 (API Versions, read 2026-10-22; the third fix round named it 2026-09-02, the entry below it), which every later version keeps, says "Zero-amount payments are included, so the proxy's `include_free` is gone" and that "any proxy-only filter" is a 400, so the pinned list gives them with no parameter and none is sent (`include_free`, "Defaults to false", belongs to the older list a key without the pin answers); a $0 payment is never a real payment, so `first_paid_at` (THE RULE of `first-payment.ts`) is as it was. A student with no code anywhere and one course membership costs 3 reads in two answers' time (the membership, then the user's list beside the payments), so the request routes answer inside their limits while Whop takes up to about 3.9 seconds an answer (at 2.5 seconds, about 5.3 seconds in all: `membership-discount.test.mjs` measures it); until the fourth fix round 4 reads in a row did, so a Whop slower than 2 seconds an answer gave their 503. Each further course membership on the list that grants access is one read more after them, in a row; the ended ones, since the fifth fix round, one answer's time more however many, so a student with two of them beside the one on file answers inside the limits while Whop takes under 2.5 seconds an answer (6.5 seconds at 2.0, where the fourth round's reads in a row gave the 503); a student with a code on the membership on file costs 3 in a row (the membership, its plan, the code's name). **Until the fourth fix round** a course membership that no longer grants access was never read; the price judged every real course payment; the name of this student's own code counted with no request of theirs; a v2 list in another shape, holding another user's row or naming more than 4 pages read as no memberships, and a membership read answering 200 with a body that is no JSON object (`[1,2]`) read as no code, kept for the rest of the check; a stored no coupon answered whenever its `source` named a step; and the normal Approve went on when the check gave no answer. So a 100% first month or a first-year code on a membership since canceled or expired, the student back at 97.00 on a new one, another student's ECOM30 code sharing 6 characters, and a stored no coupon the world-engine preview wrote for a welcome50 student each let a student who came in on a code apply, while a later 10.00 manual charge or 47.00 add-on refused one who came in at full price. **Until the fifth fix round** a stored no coupon answered whichever build wrote a step's word into its `source` (a89ff1c's and the world-engine preview's rows for a 100% first month on a canceled membership among them), and a student whose row could not be read was answered by a stored no coupon of any membership; a membership read answering an object of another id, wrapped (`{ data: {...} }`), `{}` or naming no code field read as a membership naming no code; a payment naming no buyer was skipped; another product's membership on file was read for its code (its `other20` refused a course student at 97.00); a payment naming no code that came to less than its subtotal was judged by the price alone (a 0.00 of 97.00, 873.00 of 970.00 and EUR 44.95 of 89.90 let the student in); the price took the first payment listed at its moment (a 10.00 add-on listed before the 97.00 checkout refused); the ended memberships were read one after the other (two of them gave the 503 at 2.0 seconds an answer); and a no coupon judged without the user's list was stored with its source, so the fallback answered with it. **Until the third fix round** a code on a membership counted only when it took money off the next renewal (`isDiscounted`, THE RULE, which the 30% page's read of its Approved rows still uses), so a used code renewing at full price was none; the user's memberships were read only when the id on file was missing, a payment's, unknown or on a free plan, so a second membership on a 100% code beside a full-price one on file was never read; any ECOM30 code was the team's (`isTeamThirtyCode`, gone); a payment's code counted only when it took money off; no $0 payment was read; and the price also judged a payment naming a code, a plan change's charge and, at its `usd_total`'s rate, a payment in another currency. So a 100% first month (0.00, then 97.00, the used code on the membership), a first-year 10% yearly whose payment names no code, welcome50 on a EUR membership whose payment names none, a second membership on a 100% code and a public code named ECOM30 each let a student who came in on a code apply, while a plan change's 12.34, or a EUR 89.90 whose `usd_total` read 96.99, refused one who had none. Until the second fix round only the newest real payment was judged, and only when no membership answered; until the first, only "a total under 97.00" was read. The fields are Whop's payment object at `2026-10-15-1` (its public API reference, read 2026-10-21 and 2026-10-22; every payment carries them): `subtotal`, "The price before discounts, tax and fees"; `tax_amount`, "The sales tax or VAT collected. Null when no tax applied"; `tax_behavior`, "Whether `tax_amount` was added on top of the price (`exclusive`) or was already inside it (`inclusive`)", whose list of values holds four, `exclusive`, `inclusive`, `unspecified` and `unable_to_collect` (the key's older shape has been read with all four and with none); `currency`, "The currency the payment settles in"; `billing_reason`, "Why the charge was created", one of `subscription_create`, `subscription_cycle`, `subscription_update`, `one_time`, `manual` and `subscription` (the reference names no proration and does not say what each value means; `subscription_update` is read as a change to the subscription by its name, and the list's own filter says "`subscription_cycle` also matches renewals recorded as `subscription_update`"); `promo_code_id`; the key's older shape has the same names with bare numbers. The check gives no answer only when Whop does not answer (no connection, a 5xx, a 429 after its two retries, the time limits), refuses the key (401, 403), answers the payments or, since the fourth fix round, the user's list of memberships in a way it cannot judge (`filter_ignored`, a row of another user; `bad_page`, a page in another shape, its `data` no list of objects or its rows naming no buyer or no membership id; `too_many_pages`, more pages than one user has, said by the first page that names more), answers a membership read with a body that is no JSON object (`bad_shape`, since the fourth fix round, never kept for a second read) or, since the fifth, an object whose `id` is not the membership asked for (a wrapped body and `{}` among them) or that names neither `promo_code_id` nor the key's older `promo_code`, a field Whop's schema requires on every membership (`bad_shape` too), or the deployment cannot ask (no key, `no_course_product`, `no_whop_user`); those are the only kinds in the cron's `failed`. A 404 or another 4xx for the user's list (a 410 once v2 is gone) is no answer either way: the check goes on without the list, by the membership on file and the payments. The cron's answer counts `by_source` (`membership`, `user`, `payment`), `no_real_payment` and, since the fourth fix round, `user_list_unusable` (the students whose list answered such a 4xx, so a list that stopped answering shows), lists `refused_by_price` (the students the price alone refused, source `payment` and no code, by student id, each with that payment's price and `billing_reason`, so the owner can rule on real cases) and, since the fifth fix round, `refused_by_subtotal` (the students a payment naming no code refused by its subtotal, each with its price, subtotal, currency and `billing_reason`), and no longer has `skipped`. **The stored row:** `discounted` is the check's answer, a coupon (on a membership row it can differ from `isDiscounted`: a used code renewing at full price is a coupon, the student's own 30% still on the next renewal is not); `whop_membership_id` the membership carrying the code, for a payment on a coupon that payment's own (when it names none, the membership settled on), for a row with no coupon the membership settled on, else the membership whose read gave no price, else the first real payment's own (the newest's until the fourth fix round); `source` (v113) **the rule stamp** since the fifth fix round, the step with the rule's version (`r5-membership`, `r5-user`, `r5-payment`: `storedSourceOf`; the step's word alone until then, which v113's check now refuses), and `source_checked_at` (v113, since the fifth) the `checked_at` of the write that set it; both empty on a no coupon judged without the user's list (a 404 or another 4xx for it, a 410 once v2 is gone), so the fallback never answers with it, while the student gets that live answer (THE V2 SHUTDOWN, until T-113 moves the list to v1); on a membership row the membership's renewal price and its plan's (each empty when it did not read; the plan's always empty on a membership naming no code since the fourth fix round, which reads no plan for it); on a `payment` row `renewal_price` the payment's price after discounts in its own currency (empty when its total does not read) and `plan_renewal_price` its subtotal when it names a code or, since the fifth, shows a discount naming none, 97.00 when the price judged it, else empty (both empty with no real payment), the code the payment's. Without v113 the write is refused for its stamp's columns (PGRST204 or 42703 naming `source` or `source_checked_at`) and made again without them, once per run. **The stored fallback (since the third fix round, narrowed in the fourth and the fifth):** when Whop gives no answer, the request routes and the approve route read the student's stored row with its `source`, `source_checked_at` and `checked_at`: a stored coupon answers whoever wrote it; a stored no coupon only when this rule wrote it and nothing wrote over it since, its `source` carrying this rule's version and its `source_checked_at` its `checked_at` (`stampedByThisRule`, since the fifth fix round; a step's word alone answered until then), when it names no code or this student's own 30% by the promo id on their own approved or applied request (`storedNoCouponAnswers`, since the fourth), and when the student's own row could be read (since the fifth: with it unread the membership on file is not known, and a stored no coupon of any membership answered; only a stored coupon answers then, and a warning line says so). A step's word alone does not say this rule wrote the row: the world-engine preview (`6109e1e`, T-122's first fix round) stores a student who came in on welcome50, the used code on their membership at 97.00, as no coupon with source `membership`, and a89ff1c (the third fix round) stores a 100% first month on a canceled membership, the student back at 97.00, as no coupon with source `membership`; after v113 their writes carry a word its check refuses, so they store nothing (each logs the failed write and keeps its live answer; a cron of theirs would stop at its first write and answer 500). An upsert whose payload leaves the columns out keeps the ones already on the row (PostgREST's upsert sets the payload's columns alone, `INSERT ... ON CONFLICT DO UPDATE`, which the re-check ran on PGlite and `supabase/migration-tests/v113.test.mjs` runs), so a build from before T-122 writing over this rule's row keeps the stamp with a new `checked_at`: the two times differ, and the row is no answer. A row with no source was written before v113 was pasted, by the rule production's cron has run every 2 hours since 2026-10-21 11:37, which let the cases above through, or since the fifth fix round is a no coupon judged without the user's list: it is no answer. The log line names why a stored no coupon did not answer: no source, an older rule's source, written over since, a code not the student's own, or the student's row unread. With no answer from Whop or the stored row (source `none`) the request routes give their 503, and since the fourth fix round the normal Approve is refused too (503, code `rule`, the reason in the team's words: `couponUncheckedApprovalRefusal` in `discount-server.ts`), while Approve anyway, a founder's or an admin's, goes on with "The coupon check gave no answer." in its log line; until then the approval went on. On a database without v113 the read naming `source` is refused (42703) and made again without it, so a stored no coupon never answers there, and the writers keep writing without it as before. A stored row still counts only for the membership it was read from, except that when the id on file is not a membership's (a payment's, or none) the student's row counts (`storedRowApplies`, also the reader of `/api/student/data` and of the 30% page's `couponOf`, which read the flag and the rows as they are, source or none). **Known limits:** a 100% code's $0 payment, a code named on the membership while the payment names none or does not read, a payment in another currency naming no code, a plan change's charge, a second course membership on a code and another student's or a public ECOM30 code are no longer among them (the third fix round), nor a code on a membership that no longer grants access, a later charge under 97.00, another student's ECOM30 code sharing 6 characters, a v2 list or a membership read answering in another shape, and a stored no coupon an older build wrote with a source (the fourth), nor a stored no coupon a build of an earlier round wrote with a step's word or a build from before T-122 wrote over, one answering for a student whose row could not be read, a membership read answering an object of another id or naming no code field (`{}`, a wrapped body: the fourth round's limit 12), a payment naming no buyer, another product's membership on file, a discount a payment naming no code shows below its subtotal, an add-on listed before the checkout at the first payment's moment, and two ended memberships at 2 seconds an answer (the fifth). Still: (1) the memberships found through the Whop user rest on Whop's v2 list (`GET /api/v2/memberships?user_id=`), which Whop says stops working on 13 November 2026 (every v2 answer carries `Sunset: Fri, 13 Nov 2026 00:00:00 GMT`; the workspace's `_admin/prds/first-paid-fix/facts_whop.md`), and it is read for every student whose membership on file shows no code; from then, if the list answers a 404, a 410 or another 4xx (not 401, 403 or 429), every such student is judged by the membership on file and the payments alone, so a code on a second course membership, or on one since canceled or expired, shows only on its payments: a 100% first month whose $0 checkout Whop leaves out of the list, or lists naming no code and with no subtotal above it, then passes (the fourth round's re-check, its R4, R5 and R7, which stay open until the list moves). The student gets that live answer; since the fifth fix round its row is stored with no source, so no stored fallback ever answers with it, and the cron counts those students in `user_list_unusable`, so the change shows on the first run it happens. If the list answers a 401, a 403, a 5xx, nothing or a page this code cannot read, every such check is no answer and no student can apply (the request routes' 503) until the read moves off v2. This caller's v1 successor in Whop's reference for `2026-10-15-1` is `GET /api/v1/memberships` with `user_id` and `product_id` (`tasks.md` T-113), never tried here; the login's self-heal, the sync and the webhook read v2 too, so moving them is its own job. (2) The plan read is `GET /api/v1/plans/{id}`: Whop's reference for `2026-10-15-1` lists plans as variants (`GET /api/v1/variants/{id}`), and `/plans` is deprecated there and still answers, with `Deprecation` and `Link` headers (API Versions; `facts_whop.md`); since the fourth fix round it is read only for a membership naming a code (its row's plan price, and the student's own 30%), so should it stop answering with a 4xx such a membership is still a coupon and the student's own code reads as one whose plan does not read (the payments answer), while a 5xx is no answer for the student's own code alone. (3) The price reads the first real course payment naming no code against 97.00 alone, so a cheaper plan's first payment (the $1 and $5 plans, a $1 or $5 first week then 97.00) reads as a coupon, each listed in the cron's `refused_by_price` for the owner to rule on; so does a first payment settled in dollars under 97.00 from another currency (Whop's adaptive pricing: the re-check's 96.99 settled from a EUR 89.90 presentment); and a discount that shows neither as a code nor as a payment below its subtotal (a plan priced lower, a price set by hand) is not seen at 97.00 or more. (4) The first real course payment is the one `first_paid_at` names, which is the student's first real payment for any product: a payment naming no product (`product_id` null, which Whop's reference allows on a payment that predates its item snapshots) counts as a course payment, so an older purchase of another product under 97.00 (the re-check's 47.00, its probe P1, and the fourth round's re-check, its L6, a 20.00 variant with no product) reads as the first course payment and refuses by its price, and one naming that product's own code (P2) refuses by the code; its line items name the product and are not read. (5) The price judges no payment in another currency, so a coupon there that shows neither a code nor a price below its subtotal is not seen, and no charge recorded as `subscription_update`, which the list's filter says some renewals are too; such a charge is not judged by its subtotal either, since a plan change's proration takes money off by itself. (6) A $0 payment shows only when Whop lists it as paid: a 100% code's checkout it leaves out shows its code on the membership alone (an ended one too since the fourth fix round). A $0 payment naming no code is no coupon when its subtotal is 0 (a free claim) and, since the fifth fix round, a coupon when its subtotal is above it: whether Whop states a free trial's checkout, or a free claim's, at the plan's price is not checked, so such a student would be refused, listed in the cron's `refused_by_subtotal` for the owner to rule on. (7) A stored no coupon without this rule's stamp from one write (no source, an earlier round's word, written over since), or naming a code other than the student's own, is no answer until the cron rewrites the row by this rule, so after the deploy and v113 a student whose row is older reads the 503, and the normal Approve refuses, whenever Whop gives no answer, until a write run of the cron reaches them (Whop answering, they are read live as before); without v113 that holds for every stored no coupon, and so it does for a no coupon judged without the user's list. After a rollback to a build from before T-122, every row it writes over reads as written over until this build's cron rewrites it (the cron reads them last, as they read as freshly checked); a build of an earlier round of T-122 stores nothing once v113 is pasted (its writes refused and logged, a cron of its own answering 500) and asks Whop live as it did. (8) Each course membership on the user's list beyond the first that grants access is one read after the list and the payments, in a row, and one naming a code two more (its plan, its name); those that no longer grant access, since the fifth fix round, one answer's time all at once (two beside the one on file pass the limits at 2.5 seconds an answer, the fourth round's re-check, its T5, and answer inside them at 2.0). So a student with several, or a Whop slower than about 3.9 seconds an answer with one membership, passes the request routes' limits (no read starts after 6 seconds, none waited on past 8): no answer, their 503; each cron run reaches a third fewer students than before T-122's third fix round (the client tests' run of 1,000 members with no code reads 320 in its 240 seconds, as the third round did, where the second read 480; the first dry run on production had 290 to read). (9) A coupon found on a payment or a second membership is stored for that membership, so when it is not the one on file the map and the 30% page do not show it until the sync puts that membership on the student, while the request routes and Approve ask Whop live and refuse. (10) The 30% page's own read of the Approved rows still asks by the membership on file alone, by THE RULE, so it does not flag a code that shows only on a payment or a second membership, and there the team's 30% code still on the next renewal reads as a discount, marked the team's own. (11) The dev page's fixtures (`src/app/dev/admin/fixtures.ts`) still store a used welcome50 at full price as no discount on Maya's row, the made-up student the admin pages walk approves, a row the cron no longer writes. (12) A membership read naming no product (neither `product_id` nor the older `product`) is read as the course's, as the v2 list's rows naming none are, so another product's code there would refuse a course student; Whop's schema requires the field. (13) While a student holds an approved or applied request of their own, a code named as Approve names theirs counts as theirs whatever its promo id, so another student's code by the same name (their ids sharing 6 characters) would pass; the approve route expects Whop to refuse a second code by one name, so it would not be made (not checked), and such a student can make no request and is left out of the cron, so only their stored row and the map would say no coupon. (14) A payment row naming no buyer is read for a code it names or a discount it shows, never for its price (the first-paid rule leaves it out too, so `first_paid_at` never names it). (15) The subtotal reads every course payment naming no code, a renewal too: a renewal Whop discounts with something other than a code (store credit, a proration recorded under another reason than `subscription_update`) refuses the student, listed in `refused_by_subtotal`. From the fifth round's re-check (2026-10-22), also still, each needing Whop to answer against its own reference or an older build to run: (a) a v2 list answering 200 that leaves out the membership carrying the code (a 100% first month on a canceled membership whose $0 checkout Whop does not list) lets the student in, and the row is stamped and trusted; (b) a membership the v2 list names whose v1 read answers 404 or another 4xx is passed over, so its code is never seen; (c) the subtotal test compares a total and a subtotal stated in different currencies; (d) a subtotal that already includes an exclusive tax refuses a full-price student; (e) `WHOP_PRODUCT_ID` naming plan ids alone makes every check answer no coupon (production names the product); (f) the ended memberships are read only once the payments read has answered, so many of them at 2 seconds an answer give a false 503; (g) the cron writes up to 25 judged rows later, each with its own `checked_at`, so it can write an older answer over a request route's newer one; (h) a preview of an earlier round pointed at the production database still answers students by its older rule (retire or redeploy those previews at step (b) below). These are the workspace's task T-128. **Not checked live:** v2's user filter and its rows for a membership that no longer grants access (status `canceled` or `expired`, `valid` false), the pinned payments' `product_id`, `membership_id`, `promo_code_id`, `subtotal`, `tax_amount`, `tax_behavior`, `currency` and `billing_reason`, the $0 payments' place in the pinned list and their status, an ended membership's v1 read still naming its code, the v1 membership read's `id` and `product_id` (since the fifth fix round), a $0 checkout's `subtotal` for a free trial or a free claim, a payment row naming no buyer in a user's filtered list, and the team's own codes' name (`code`, ECOM30-...) on the promo code read have only met the tests' stand-in Whop, written to the shapes in `facts_whop.md` and Whop's API reference for `2026-10-15-1`. **Before `/ship`,** in this order: (a) a `?mode=dry` run of the cron on the preview first (`GET /api/cron/refresh-membership-discounts?mode=dry` with `CRON_SECRET`; it writes nothing), expecting `failed` empty, `checked` equal to `candidates`, `user_list_unusable` 0, the 46 the first run could not read counted under `by_source.user` or `by_source.payment`, `discounted` counting the students in the window who came in on a code, a used one included, and `refused_by_price` and `refused_by_subtotal` for the owner to rule on (a free trial's checkout in `refused_by_subtotal` would say Whop states it at the plan's price); (b) the deploy of this build, the fifth fix round's, to production, so no build of an earlier round of T-122 and none from before it runs the cron or the routes there; (c) then v113 pasted (`supabase/migrations/2026_v113_membership_discount_source.sql`), whose check refuses an earlier round's words and empties any a database already holds, so a preview of an earlier round still running stores nothing from then (until v113 no stored no coupon answers at all); (d) then the cron in write mode until `left` is 0, before anyone approves, so every stored row is this rule's, stamped: until then the request routes and the normal Approve refuse, when Whop gives no answer, every student whose stored row this rule did not write.
- All four gates (`request`, `submit-feedback`, `approve`, UI) treat NULL `first_paid_at` as ineligible (v75.26 closed a discount-leak that let returning customers get a fresh 14-day window via the `joined_at` fallback). Since the first-paid fix (2026-10-20) `first_paid_at` is the student's first real Whop payment, so a free member with no payment holds NULL, and the map tells them it can't see their first payment yet.
- **A double submit (2026-10-16, needs v106).** Two Apply clicks sent together can both pass a route's checks before either is written; v106's index refuses the second insert (23505 on `discount_requests_one_pending_per_student`). `request` and `submit-feedback`, on either course, answer it as a request already in review: 400 `{ error: "You already applied for the discount. We're reviewing it.", state: "pending" }` (`secondPendingRequest` in `src/lib/world/discount-server.ts`), never the database's words. The first request stands and the team's task hook runs once. Any other failed write (since 2026-10-17: a foreign key, a value that is not a uuid, v29's own two refusals, a 23505 on another index, no connection) gets one plain sentence, `SAVE_FAILED` ("Something went wrong saving that. Try again, or ask the team in Discord."), at the status it had (Apply 500, the questions form 400), and the whole error goes to the server log under `[discounts/request]` or `[discounts/submit-feedback]`; nothing is written and the team's task hook does not run. Before v106 is pasted both rows go in (T-057)
- **The questions form's function is the server's (2026-10-17, needs v107).** `submit-feedback` calls `submit_discount_with_feedback` with its service-role client and the student id from the token. v107 takes EXECUTE from `public`, `anon` and `authenticated`, gives it to `service_role`, and the function itself refuses any caller whose token is not the service role's (`auth.role()`), so a student holding a session can no longer make a pending request with one call, past the routes' checks and past the closed doors. Until v107 is pasted, v29's own check refuses the route's call and the student reads `SAVE_FAILED`: v107 goes in on Monday after the merge into `main` and before the doors open (`tasks.md` T-090). On the new course `approve` also refuses, where the rule would approve, a request the app's Apply could not have made: one made more than 5 minutes (`REQUEST_GRACE_MS`) after the student's deadline, and one beside another of the student's requests that counts and was rejected, approved or applied (`madeOutsideApply` in `src/lib/world/discount-server.ts`). Generate anyway skips both, as it skips every gate.
- **The new course's rule (branch `world-engine`, 2026-10-14).** Where
  the catalog has the v2 shape (`CATALOG_IS_V2`: the staging catalog,
  and the live one after the switch), `request`, `submit-feedback`
  and `approve` use one rule shared with the map,
  `discountState()` in `src/lib/world/discount.ts`, fed from the
  database by `src/lib/world/discount-server.ts`: 30% off once every
  counting `watch` lesson up to and including the `is_gate` lesson
  (`a4l17`, the end of Video Ads II) that has a video has its video
  done, by the student's deadline, `discountWindow()` (T-080, Lovro
  2026-10-16): 14 days from a first payment on or after 9 October 2026
  (the launch); the end of 23 October 2026 in Croatia for a first
  payment from 1 October 2026 until the launch, one deadline they
  share (`DISCOUNT_SHARED_DEADLINE`, 2026-10-23T21:59:59.999Z, since the
  window's end counts as inside it); never for an earlier first payment
  (`DISCOUNT_ELIGIBLE_FROM`, 2026-09-30T22:00:00Z, midnight on 1 October
  in Croatia; Lovro moved it from 9 September on 2026-10-19, so a
  September joiner is outside the offer). A lesson finished on
  Whop counts with the time the app recorded it (the backfill's run or
  the webhook's arrival; for a row the Whop catch-up added, the moment
  the member opened the lesson on Whop, T-089). The state carries `window` (`"own"` or
  `"shared"`). Since 2026-10-20 a student reads the same words for both
  (Lovro: "a lot of confusion for the 30% off"): the panel says the rule in
  one line, "Finish every video through Video Ads II within 2 weeks of
  joining to apply." (`discountRule` in
  `src/components/world-v6/checkpointView.ts`; "2 weeks" is
  `DISCOUNT_WINDOW_DAYS` in words, and `client-tests/discount.test.mjs` fails
  if that is ever not 14), the shared group's own date shows in "Apply by"
  and, once it has passed, in "This closed on", and a refused request says
  only the fact ("Your deadline for the 30% has passed.",
  `discountRefusalMessage`). Only the team's approval refusal still reads
  `window`. A first payment before 1 October reads "Your 2 weeks have
  passed." with no date, so a student whose stored `first_paid_at` is still
  a free membership's earlier date reads that until the first-paid repair's
  write (`POST /api/admin/first-paid-repair`). A request decides what the student
  sees from then on, so a rejected student cannot apply again, and
  `requestCounts()` says which requests count, one 30% per student
  (T-080 fix round). One made from 9 October on always counts. One made
  before it, on the old dashboard, counts only for a first payment from
  1 October until the launch, and only while pending, approved or
  applied, because v29's submit function refuses another request while
  one of those exists, whatever its date. A rejected old request, and
  everyone else's old requests (a June request of a student the offer
  is closed to, for one), play no part. Such a state carries
  `madeBeforeLaunch`. `approve` checks the rule again as of the end of
  the student's window. A request made before the switch is judged by
  the videos the course had at the switch (2026-10-17: until then every
  new-course video counted as loaded after a request from the old dashboard, and
  finished or not read the same), so a student who finished in time is
  approved by the normal button; when it refuses one over its videos it
  says to judge it by hand, with the count after it
  (`explainOldCourseRequest`), and a refusal over the first payment
  keeps its own words. Since 2026-10-17 the switch's date is read before
  the verdict, and a failed read of it approves nothing (500). The
  "ads verified" check that ran after the rule is gone since 2026-10-20
  (Lovro's decision), on both shapes; "generate anyway" still
  skips every check. Every read that fails, or no video
  up to the gate, means no request and no approval. On the old shape
  the routes behave as before, except that an empty or failed read of
  the R1 + R2 lessons answers 409 ("The course changed and this check
  cannot run. Nothing was requested." / "...Nothing was approved.")
  instead of letting the request through (cutover WI-9): that is what
  the new data would look like under a build that still has the old
  shape. The calls are D1 to D14 and L1, L4 in the morning review.

**Webhooks**
- `POST /api/webhooks/whop` — HMAC-verified Whop events. A lesson
  finished on Whop writes the student's completion row, and since
  2026-10-16 it also finishes a row that already exists (a skip, a saved
  Discord link, an action done before its video): `completed_at` set
  now, `skipped_at` cleared, the link and the action half kept; a row
  already watched keeps its time. On the delivery that finished the
  lesson it then runs the steps the app runs after one
  (`afterCompletionWrite`: the streak, the "came back" check, the badges,
  the CSM tasks), once, never on a retry; until then a row that existed
  was dropped silently. A failed write answers 500 so Whop retries.
  Since 2026-10-22 (branch `night/action-done`) a lesson of the seven
  action items finished with Done alone (`isDoneOnly` in
  `src/lib/world/action-items.ts`) gets its action half in the same
  write as its watch half, on a row added or finished that has none, at
  the moment the event arrives, so it is done in the app with nothing to
  press (the owner's rule: a lesson finished on Whop counts). That write
  asks for an empty action half, so a row whose action half is in (Done
  pressed on `a5l08` or `a5l12` before its video) keeps it: the write
  every other lesson gets finishes its watch half alone. A row of one
  that already holds the watch half alone is left as it is: the
  backfill at the student's next login or visit fills it. Every other
  lesson's write is as it was.
  Membership and payment events (login-1, 2026-10-20) write a student
  row only for a product in `WHOP_PRODUCT_ID` (comma separated); the
  company's webhook is taken to send every product's events (no real
  delivery of another product's has been seen), and another product's
  used to be written as `active`. While the list named the course
  alone, that row was the only way into the app for an Apex seat or an
  ETfB membership without the course, since the login's own Whop check
  and self-heal accept only `WHOP_PRODUCT_ID`. The owner's call
  (2026-10-20): Apex and ETfB members keep the app, so production's
  `WHOP_PRODUCT_ID` names three products, the course
  (`prod_eE7r6SXa3H0MX`), ETfB for brands (`prod_bGNf1u02RruKC`) and
  Apex team seats (`prod_vCHZUO8dU4ts2`), from the first deploy after
  it was set. The login check, the self-heal, the 2-hour sync and this
  webhook read the one list, so a membership of any of the three gets
  in and one of any other product is turned away
  (`whop-product-setting` client test). A fifth reader,
  `fetchWhopMembershipJoinDate` in `src/lib/whop.ts`, gives a new
  student's `joined_at`: with more than one id it reads the user's
  first 10 memberships of any product and takes the earliest on a
  listed product, or the earliest of all 10 when none is listed. "The
  course" below means the products the list names. What the wider
  list brings: the sync makes a row for every Apex and ETfB member, and
  on plans outside `PAYING_WHOP_PLAN_IDS` they stay out of the counts
  that filter by plan (the Dashboard, Insights, the journey's counts)
  and the CSM crons, and get no first payment from the sync; the 30%
  page lists anyone with a real first payment of any product, so an
  ETfB owner who has paid shows there, and so did All students (admin
  rebuild 2, D9) until the owner's answer of 2026-10-21 (course members
  only, and only the $97 ones): since then All students and the
  Student journey list course members on one of the two $97 monthly
  plans alone (`MONTHLY_97_PLAN_IDS`), so an ETfB owner is on neither
  (an Apex seat is a free team link, so with no payment of its own its
  `first_paid_at` stays empty and the 30% checkpoint reads "Ask the
  team"). Which of a user's memberships the row holds follows one
  order (2026-10-20, `outranks` in `src/lib/whop-members.ts`; the
  course product is any listed product but ETfB and Apex,
  `isEtfbOrApexProduct`): (a) one that grants access (active or
  past_due) over one that does not; (b) active over past_due, since
  past_due locks the person out of the app (`MembershipBlockOverlay`,
  the lesson-video route); (c) the course product's over an ETfB or
  Apex one; (d) the newest `created_at`. Between two that grant no
  access only (d) decides, as before. The sync's dedupe follows it,
  and so does the lookup (`lookUpActiveMembershipForUser`;
  `fetchActiveMembershipForUser` gives its pick alone) behind the
  login's self-heal, the webhook's re-point after a membership ends
  and its writes for an event that names no product: each of its three
  reads collects the memberships that grant access on a listed product
  and returns the one the order puts first (it took the first one Whop
  listed until then). Its second read picks only when every listed
  product's read answered: one that fails hands over to the third read
  (the order's second review, 2026-10-20). So a course member who also holds an Apex seat
  or an ETfB membership stays on the course product's membership and
  its plan, and so in the CSM crons' pool, while that membership is
  active; a course membership whose renewal failed (past_due) gives
  way to an active seat or ETfB membership, so the person keeps the
  app, and until the course is paid again the row is on that plan,
  outside `PAYING_WHOP_PLAN_IDS`: the admin counts stop counting them
  as paying, and the CSM cron's guard for a past_due student's open
  save task (`check-csm-tasks`, past_due with `cancel_scheduled_at`)
  no longer sees them, so that task is dismissed. The login leaves a
  past_due row to the sync: it asks Whop only when the row is neither
  active nor past_due, so step (b) never runs at login. An
  ETfB or Apex activation or payment follows the order as far as the
  stored row can tell (`etfbOrApexMayWrite`): it writes a row for a
  user with none, a row already on its membership, a row that grants
  no access, and a past_due row when the write is active; it leaves a
  row that is active on another membership, and a past_due row beside
  a past_due write, as they are (the row holds no product or date, so
  steps (c) and (d) are left to the next sync); a failed read of the
  row answers 500. With no product in the payload only the membership
  the lookup found is compared with the row: the event's own id may be
  the course membership the row is on. The read and the
  upsert are two calls: a sync or event that writes the row between
  them is overwritten, and the next sync puts back the one that wins.
  Two dates do not follow the order: `first_paid_at` is the student's
  first real payment for any product of the company
  (`src/lib/first-payment.ts`), and `joined_at` comes, for a new
  student at the login, from `fetchWhopMembershipJoinDate` (the
  earliest membership on any listed product, above) and, on a webhook
  activation, from Whop's `joined_at` (the user's first join to the
  company); only a row the sync or the self-heal makes starts from the
  picked membership's `created_at`. A webhook payment carries no
  `joined_at`, so its upsert writes the time it arrived over the
  stored one (main did the same before login-1, and it still does:
  measured 2026-10-20 on the route's test copy). Without the course rule
  the sync takes the newest membership that grants access and the
  webhook writes every such event, so a newer Apex seat or ETfB
  membership would take a paying student off the paying plan, and the
  CSM cron would drop them from its pool and dismiss their open tasks.
  Another product's event
  answers 200 and writes nothing (its membership ending asks Whop
  nothing either),
  with one exception: a membership ending that the student's row still
  points at (`whop_membership_id`) is the row the old webhook made for
  it, which the sync never closes (it walks only the course's
  memberships). That row is settled as before login-1: re-pointed at a
  course membership Whop lists, else canceled, and the write lands only
  while the row still points at it. A `payment.succeeded` points the
  row at the payment's membership (`membership.id`, else
  `membership_id`, else `membership` as a bare id; the payment's own
  id only when the payload names none). Until 2026-10-20 it wrote the
  payment's own id (`pay_...`), as main did before login-1, which no
  membership event names: a row of a product outside the list that a
  payment made then is closed only by a cleanup (a listed product's
  member's row is re-pointed by the next sync).
  An event with no product writes only the course membership Whop lists
  for that user, with its own status. A deactivation, of any product,
  that finds nothing granting access on Whop cancels the row only when
  the row points at the membership that ended, and only while it still
  does; a row on another membership is left for that membership's own
  event or the sync. When no read of the lookup answers
  (`everyReadFailed`), the deactivation writes nothing and answers 500,
  so Whop sends it again. Both since the order's second review
  (2026-10-20): until then an ETfB or Apex membership ending while
  Whop could not be read canceled a course student's row, and a course
  membership ending canceled the row whatever it pointed at.
  `supabase/diagnostics/non-course-members-read.sql` counts the active
  and past_due rows the last successful sync did not rewrite; the
  `whop-webhook-product` and `whop-webhook-old-rows` client tests run
  the route on the real Whop lookup with a stand-in fetch
- `POST /api/webhooks/adbounty` — Zak's ad-bounty system fires here on
  enrollment → stamps `student_milestones.bounty_access_claimed_at`
  (sole source of that timestamp)

**Cron** (Vercel scheduled)
- `GET /api/cron/sync-whop` — the Whop membership sync (`runWhopCommunitySync`, the same as the admin "Sync Whop" button). It pulls no lessons: a lesson finished on Whop reaches the app only through the webhook and the backfill at login or a visit (this line said it pulled watch history until 2026-10-17), and through the Whop catch-up when the team runs it (`POST /api/admin/whop-catchup`, T-089). Since the first-paid fix (2026-10-20) it writes no `first_paid_at` in its upsert and fills an empty one, on the paying plan, 25 a run, from the student's first real payment (no candidate started after 240 s, no payments read waited on past 280 s, so its `sync_runs` row is written before Vercel's 300 s); it no longer puts a free membership's earlier date back over a corrected one
- `GET /api/cron/check-engagement` — engagement scan → `disengagement_alerts`
- `GET /api/cron/check-csm-tasks` — evaluate triggers, create CSM tasks
- `GET /api/cron/check-na-tasks` — Not-Activated escalation (Day 3/5/7/10) (v51)
- `GET /api/cron/snapshot-progress` — write `daily_progress_snapshots`
- `GET /api/cron/day28-dm` — fire day-28 Discord DM
- `GET /api/cron/refresh-membership-discounts` (admin rebuild 2, D5, branch `night/a2-thirty`) — reads from Whop whether each student in the 30%'s window (a 30% window still open at the run's start, `discountWindowOpen` in `src/lib/world/discount.ts`: a first payment from 1 October and a deadline not past; active or past_due; until the render review's fix round, 2026-10-21, it read every student who first paid from 1 October, a list that only grew while their windows closed; the students read starts at `earliestOpenFirstPayment`), and since that review's second round every student holding a pending request whatever their window or membership (`pending_requests` in the answer; the first round had left them out once their window closed, and a stale stored answer then held the 30% page's row to Reject, which has no Approve to ask Whop again), of all those none with an approved or applied request, already has a coupon, and stores it in `student_membership_discounts` (`refreshMembershipDiscounts`). Since T-122 (2026-10-21, branch `night/admin3`) every student gets a yes or a no unless Whop does not answer, and since its third fix round (2026-10-22) by the owner's rule as he put it: a code other than the student's own 30% on the membership on file, on any course membership found through the Whop user (read whatever the one on file said) or on any course payment, the $0 ones too, then with no code anywhere the price of a real payment in dollars that is no plan change ("Every student a yes or a no" under Discounts, with its fix rounds); since its fourth (2026-10-22) the course memberships that no longer grant access are read for a code too, and the price is that of the student's first real course payment alone; since its fifth (2026-10-22) a payment naming no code that came to less than its subtotal is a coupon too, and every row it writes carries the rule's stamp (v113: `source` `r5-` and the step, `source_checked_at` its checked_at), but a no coupon judged without the user's list, stored with no source; in order, the preview's dry run, the deploy of the fifth fix round's build, v113 pasted, then it runs in write mode until `left` is 0, before anyone approves, so every stored row is that rule's (a stored no coupon without this rule's stamp from one write, or naming a code other than the student's own, answers nothing); the answer counts `by_source`, `no_real_payment` and `user_list_unusable` (the students whose v2 list answered a 4xx, since the fourth fix round), lists `refused_by_price` (the students the price alone refused, by student id, with that payment's price and `billing_reason`, since the fourth) and `refused_by_subtotal` (the students a payment naming no code refused by its subtotal, with its price, subtotal, currency and `billing_reason`, since the fifth), `failed` holds only the students Whop gave no answer for, and `skipped` is gone (it counted the no-id and payment-id students it could not ask). Never-read students first, then the longest unread; 4 Whop requests a second; none started after 240 s; rows written 25 at a time. `?mode=dry` reads and writes nothing. 500 when who is in the window or who holds a pending request cannot be read, a write fails, every Whop read failed, or Whop answered no read before the time ran out, so nothing was checked (since admin rebuild 2's review fix round; that run answered 200)
- `GET /api/cron/check-lesson-videos`: the lesson video lock check. It
  asks Tella about every row of `lesson_videos`, writes what it found
  on the row and posts to the team's Discord channel when a video has a
  problem or the run did not get through every video. It is NOT in
  `vercel.json`: it runs only when someone calls it with the cron
  secret, and it has never run for real. The Cron Jobs table says what
  would switch it on.

## Database — Active Tables

See [system_contracts.md](system_contracts.md) for who depends on whom.

Migrations v92 to v99 belong to the course rebuild, and their files
exist only on branch `world-engine`. They are pasted into the Supabase
SQL editor by hand. The rebuild-engine project log records v92 to v95
as applied to production on 2026-09-23, and the post-checks
(`supabase/diagnostics/prd1-postchecks.sql`, which covers v92 to v97)
as passing against production on 2026-09-24. Whether v98 and v99 are
applied is unconfirmed; `supabase/diagnostics/v6-wiring-preflight.sql`
is the read-only query that settles it. v100 (2026-10-12, the Tella
player) and v101 (2026-10-13, the real course in the staging catalog)
ran on production on 2026-10-14, with the private video and text
loads: Lovro pasted them and their results during the course catalog's
ship round (`../_admin/prds/course-catalog/state.md`). But v101
as it now stands on the branch (2026-10-14) carries every lesson's
Whop lesson id and moves the gate to `a4l17`, so it differs from any
copy pasted before and has to run on production again before the
switch (the cutover's ship order, step 3). v103 and v104 (2026-10-14,
the cutover) are on the same branch and have not been run on
production; there is no v102. v105 and v106 (2026-10-16, the backend
audit's fixes, commit `14716be`) are built offline and tested in the
migration harness, and have not been pasted on production: v105 ends
students' own writes to their lesson completions, discount requests
and badges (they still read their own rows; the server and the
feedback form's function keep writing), and v106 lets at most one
pending discount request per student in. The paste order is the
read-only `supabase/diagnostics/backend-readiness-read.sql`, then
v105, then v106; neither depends on the course switch (`tasks.md`
T-057). v107 (2026-10-17, the release review) is built offline and
tested in the harness (section 27), not pasted: only the service role
may then call `submit_discount_with_feedback`. It goes in on Monday
after the merge into `main` and before the doors open, because the
route on `world-engine` calls the function with the service role and
`main`'s with the student's session (`tasks.md` T-090). v108
(2026-10-20, the bug hunt's cron-3) is built offline and tested in the
harness (section 29), not pasted: only the service role may then call
`increment_region_quiz_attempts`, v55's security definer function, which
wrote any student's `student_region_quiz` row for anyone holding the
public key. Nothing in the app calls it, and v108 needs no other file
before it: it can be pasted at any time. v111 (2026-10-20, admin rebuild
2, D5, branch `night/a2-thirty`) makes `student_membership_discounts`; it is
on production, where the coupon cron of the rule before T-122 has written
its rows every 2 hours since 2026-10-21 11:37 (this section said it was not
pasted until T-122's fourth fix round). It runs on a local Postgres in
`supabase/migration-tests/v111.test.mjs` (`npm run test:migrations` runs
it after `run.mjs` since the lanes of admin rebuild 2 merged; alone,
`node v111.test.mjs` in that folder; 22 checks: pasted twice with Supabase's
default privileges, the team reads, a student and a visitor refused, only
the service role writes, the undo twice, then v111 again). It needs no other file
before it; paste it before the code that reads it is deployed, or the
student data route logs a failed read on every load (the flag is then
false) and the coupon cron fails on its first write. v112 (2026-10-21, the
badges for the new course) was pasted on production on 2026-10-21 at 13:56
UTC, after its code went live (`35bf390`). Its first run took away 475 badge
rows (Region Sweep 308, Two Weeks Strong 27, Habit Builder 69, Triple Threat
71 of 355), read 12,216 lesson rows as finished at their own time and 4,974
as a sync's, and the share now divides by 1,391 active members (1,137
before). It leaves 8 badges (Region Sweep and Two Weeks Strong deleted with
their holders' rows, four sentences rewritten), adds
`student_lesson_completions.completed_at_real` and judges the rows already
there by their time, takes Habit Builder from everyone who got it before the
switch's date plus 6 days (00:00 UTC, 25 October), takes Triple Threat from
every holder with no 3 lessons really finished on one UTC day, and makes
`achievement_unlock_stats` divide by every active member. Every row it takes
away goes into `archive_v112.student_achievements` with its reason, beside
the catalog and the view as they were. Deploy the code first, then paste it,
before 25 October: the code works without it, and the old code still running
after it fails to insert any badge for a student who meets Region Sweep's or
Two Weeks Strong's old rule; a second paste takes away what the old code
handed out by the old rules meanwhile, and otherwise changes nothing. It
ends with one table: a sentence, each badge's holders before, taken away and
now with its share, then the counts. It runs on a local Postgres in
`supabase/migration-tests/v112.test.mjs` (`npm run test:migrations` runs it
third, with `--experimental-strip-types`, since it imports
`src/lib/achievement-rules.ts` to hold the SQL to the app's own rules; 65
checks). To undo the switch (v104's undo) after v112, run v112's undo first.
v113 (T-122, 2026-10-21, branch `night/admin3`; THE RULE STAMP since its
fifth fix round, 2026-10-22, before it was pasted anywhere) adds
`student_membership_discounts.source` (`r5-membership`, `r5-user` or
`r5-payment`, the rule's version and the step of the coupon check that
answered, or empty, held by a check: an earlier round's word, `membership`,
`user` or `payment`, is refused, and one a database already holds is emptied
first) and `source_checked_at` (the `checked_at` of the write that set
`source`); built offline and not pasted. It needs v111 before it (without
the table it stops at its first statement and changes nothing), and the code
works without it: a write refused for the columns is made again without
them, and the one read that names them, the request routes' fallback (since
T-122's third fix round), reads again without them. Without it, though, a
stored no coupon never answers when Whop does not. The order is the coupon
check's Before `/ship` (under Discounts): the preview's dry run, the deploy
of the fifth fix round's build, v113, then the cron in write mode until
`left` is 0, before anyone approves. A build of an earlier round of T-122
writes a step's word, which the check refuses (23514): it logs the failed
write and keeps its own live answer (a cron of its own stops at its first
write and answers 500), so it stores nothing. A build from before T-122
writes neither column: a row it adds holds no source, and its write over a
row this rule wrote keeps the stamp with a new `checked_at`, which the
fallback reads as written over. It runs in
`supabase/migration-tests/v113.test.mjs` (`npm run test:migrations` runs it
after `v111.test.mjs`; 34 checks: a row with the stamp refused before it
(42703), pasted twice, this rule's three values and empty written by the
service role, the earlier round's words and any other refused (23514), read
by the team and by no student or visitor, the older builds' writes as
PostgREST makes them (an earlier round's refused whole, one from before
T-122 keeping the stamp with a new `checked_at`), the undo twice leaving
every row and v111's columns as they were, then v113 again, on a database
that holds an earlier copy of it (its words emptied) and on a database
without v111). The files that take them
back are described at the end of this section. The header of
`prd1-postchecks.sql` says its rows 40 to 48 describe v94's placeholder
seed and report differences once v101 has run; the check for v101 is
`supabase/diagnostics/course-catalog-check.sql`. What this section says
about those migrations comes from their text.

**Identity / accounts**
- `team_members` — founder/admin/CSM accounts (Supabase auth-linked)
- `students` — student row (Whop user + Supabase auth bridge).
  Identity-only after v46/v47: id, whop_user_id, name, email,
  membership_status, etc. Per-function state lives in the sibling
  tables below.
  - **`membership_status` is the sole dashboard access gate.**
    `MembershipBlockOverlay` (mounted on `/dashboard/layout.tsx`, and
    on `/world/layout.tsx` on branch `world-engine`) hard-blocks on
    anything other than `'active'` and never asks Whop. Canceled and
    expired get "Renew on Whop" (the checkout); `past_due` (a renewal
    Whop is still retrying) gets "Your last payment did not go through"
    and Whop's page for updating the payment
    (`https://whop.com/@me/settings/memberships`), never the checkout
    (login-2, 2026-10-20; letting past_due in is the owner's call).
    `POST /api/student/lesson-video` applies the same test on the
    server before it reads a video's id. So a
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
- `regions` — R1–R4 metadata. v103 adds `landmark_label` and `rail_at`,
  empty, so the switch can copy them from `regions_next`. After v104
  it holds the eight areas `a1` to `a8`, copied from `regions_next`,
  and its not-nulls on `subtitle`, `tagline`, `terrain`, `days_label`,
  `day_start`, `day_end` and the `terrain` check are dropped (recorded
  in the archive for the undo).
- `lessons` — canonical lesson list (id, region, day, sort_order,
  watch vs action, `whop_lesson_id`, etc.). After v104 it holds the 141
  lessons of the new course, copied from `lessons_next` with their
  Whop lesson ids, lengths, texts, gate and feature keys; `day` is
  null on every row, its not-null and its check are dropped, and a
  unique index (`lessons_whop_lesson_id_key`, where not null) holds
  one lesson per Whop lesson. The six keys that point at `lessons` and
  `regions` become `ON DELETE RESTRICT` under names of their own, so
  no delete of a lesson or an area can erase progress again;
  system_contracts.md lists them. No column is dropped, now or a week
  later (call C19): a dropped column that one forgotten select still
  names turns into an empty course with no error.
  - v92 added six columns. `counts_toward_progress` (boolean, default
    true; false on `l057`): the SQL progress views and the snapshot
    function count only lessons where it is true. `feature_key` (text,
    unique where set; `bounty_access` on `l057`, `playbook_unlock` on
    `l078`). `duration_seconds` (int, above 0 when set): the real
    runtime, which the watched rule needs. No code in the app fills
    it. For a course lesson (an id shaped like `a3l07`) the video load
    writes it together with the lesson's `lesson_videos` row, here and
    on `lessons_next`. For any other lesson it is set by hand when the
    row goes in, as the morning kit does for its two test lessons.
    `updated_at` (timestamptz, kept by a trigger). The other two
    are the Bunny columns, `bunny_video_id` (text, unique where set)
    and `video_ready_at` (timestamptz): they still exist in the
    database, here and on `lessons_next`, and the app no longer reads
    them.
- `regions_next` + `lessons_next` (v94, rewritten by v101): the
  staging catalog for the rebuilt course. The course is one data file,
  `supabase/catalog/course_catalog.json`: 8 areas (`a1` to `a8`:
  Introduction, Marketing Fundamentals, Video Ads I, Video Ads II,
  Static Ads, AI Ads + Content, Creative Strategy, How To Land Clients)
  and 141 rows, 140 of which count toward progress. The areas hold 8,
  11, 25, 17, 26, 22, 19 and 13 rows. A lesson id keeps the shape
  `a{area}l{nn}` (`a1l01` to `a8l13`). `a7l19` ("How To Win On The Ad
  Bounty Program") is the one row outside the count
  (`counts_toward_progress` false, `feature_key` `bounty_access`): the
  pond in place 7. `a4l17` ("The Editor's Teardown", the last lesson of
  Video Ads II) is the discount gate since 2026-10-14. Ten lessons are
  action items (`requires_action` with a brief): `a3l17` (since
  2026-10-19, Lovro), `a3l25`, `a5l08`, `a5l12`, `a5l22`, `a5l23`,
  `a6l03`, `a6l10`, `a6l17` and `a6l19`. The 30% asks for an action
  item's video only, never its hand-in (`discount.ts`).
  Five of them have no video and are `type` `setup`: `a5l22`, `a6l03`,
  `a6l10`, `a6l17` and `a6l19`. Since 2026-10-14 the lesson page can
  complete them (`ActionItemBlock`, Student Surfaces). Since 2026-10-22
  (branch `night/action-done`) seven of the ten need no Discord link: the
  four of AI Ads + Content, `a6l03`, `a6l10`, `a6l17` and `a6l19`, and
  three of Static Ads, `a5l08` (The Backbone), `a5l12` (Imitation) and
  `a5l22` (the Brand Deck); the owner: the Static Ad Brief, `a5l23`, is
  the only one of Static Ads sent to the coaches. Done alone finishes the
  five with no video; on `a5l08` and `a5l12` Done is the action half,
  and the lesson is done once its video is watched too. `a3l17`, `a3l25`
  and `a5l23` keep the link. That fact is not in the data file or the
  database: it is the list `DONE_ONLY_ACTION_ITEMS` in
  `src/lib/world/action-items.ts`, by lesson id, so it shipped with the
  code and needed no migration; `client-tests/done-only.test.mjs` fails
  when the data file's action items are not those seven and those three
  (Static Ads' four checked by their titles). A change to which action
  items need a link is a change to that list. The same list tells the
  Whop writers (the webhook, the backfill at a login or a visit, the
  catch-up) to give one of the seven that Whop lists as finished its
  action half too, so a student who works on Whop is never held at it
  (API Routes, `refresh-watch-sync` and `/api/webhooks/whop`). Since 2026-10-14
  every row carries `whop_lesson_id`, the id of the same lesson in
  Whop's course: v101 adds the column with a unique index
  (`lessons_next_whop_lesson_id_key`) and refuses unless all 141 are
  there and distinct. The switch copies it into `lessons`, which is how
  the Whop sync and webhook find a lesson after the switch.

  **How the course gets into the tables.** `npm run build:catalog`
  (`supabase/catalog/build-course-sql.mjs`) writes
  `supabase/migrations/2026_v101_course_catalog.sql` and
  `supabase/undo/2026_v101_undo.sql` from the data file, and
  `npm run build:catalog -- --check` fails when either is stale. The
  two SQL files are never edited by hand. v101 renames the 8 areas and
  rewrites `lessons_next` in place: a lesson whose id is already there
  is updated and keeps its `created_at`, and a row the course does not
  have is deleted. It never writes `duration_seconds`. It refuses,
  changing nothing, to retitle or delete a lesson that a
  `lesson_videos` row or a `student_lesson_watch` row points at, to
  turn a lesson that has a `lesson_videos` row into a lesson that is
  not a `watch` lesson, and to run while a `lesson_videos` row sits on
  a course-shaped id that has no lesson in `lessons_next`. It can be
  run again. The generator refuses a data file with a link in a brief:
  an `http` address, a `www.` address or a bare domain.

  **v100 and v101 ran on production on 2026-10-14** (course catalog
  ship round). Before that, production's `lessons_next` held v94's
  placeholder seed (145 placeholder lessons, `a5l25` as the gate); the
  copy of v101 pasted then predates tonight's gate move to `a4l17` and
  the Whop ids, so v101 runs again before the switch. Production rows were not read for this
  document: the numbers are the data file's and the two migrations',
  and that v94 is applied there is the rebuild-engine project log's
  record.

  `lessons_next` has no `day` column, its `sort_order` runs 1 to N
  across the whole course, and its `type` is `watch` or `setup` only.
  `regions_next` also has `landmark_label`,
  `rail_at` and `terrain`; v99 filled them with the first prototype
  map's values (Lighthouse to Obelisk), and the v6 map reads none of
  the three. Any signed-in user can read both tables and nothing in
  the app writes them.

  **Which catalog the app reads is one server-side switch.**
  `src/lib/catalog-tables.ts` turns the env var `CATALOG_TABLE_SUFFIX`
  (empty or `_next`; any other value throws when the module loads)
  into `REGIONS_TABLE` and `LESSONS_TABLE`. These routes read the
  catalog through those names: `GET /api/student/data`,
  `POST /api/student/lesson-video`, `POST /api/student/lesson-watched`,
  `save-action-link`, `mark-action-shipped`, and on the v2 shape the
  discount routes. Everything else (the crons, the admin pages, the
  achievements code, the discount routes' old branch, the Whop sync
  and webhook, `toggle-lesson`, `/admin/cutover`) reads `lessons` and
  `regions` by name. The lock check reads `type` and `duration_seconds` from both
  `lessons` and `lessons_next`, each by name. `StudentContext` gets its
  catalog only from `/api/student/data`, so a deployment with the
  suffix set serves the
  staging catalog to `/dashboard` as well as to `/world`. A second env
  var, `CATALOG_SHAPE` (empty, `v1` or `v2`), says whether the catalog
  has the v2 shape (no `day`, one `sort_order` for the whole course).
  The staging tables always count as v2, and the data route picks its
  ordering from that. After the switch the suffix is empty (the new
  course is in `lessons`) and `CATALOG_SHAPE` is `v2`; both are server
  values, so a client component always sees `CATALOG_IS_V2` false, and
  admin pages tell the courses apart by `curriculum_reset_at` instead
  ([The course switch](#the-course-switch-cutover)).

  **A staging lesson cannot be completed.**
  `student_lesson_completions.lesson_id` references `lessons(id)`, and
  the `record_lesson_heartbeat` function accepts only a lesson that
  exists in `lessons` as a `watch` lesson with a video. A lesson that
  exists only in `lessons_next` can be listed and opened, and nothing
  can mark it done. A `lesson_videos` row for such a lesson changes
  none of that: with the switch on `_next` the video would play, every
  heartbeat would be refused, and nothing would be recorded. That
  holds until v104 copies the course into `lessons`.
- `lesson_videos` (v100): which Tella video plays for which lesson, and
  what the last lock check found. One row per lesson that has a video;
  no row means "not recorded yet". Columns: `lesson_id` (primary key),
  `tella_video_id` (unique, and checked against
  `^vid_[a-z0-9]{10,64}$`), `lock_status` (`unchecked` on insert, then
  `locked`, `open`, `missing` or `error`), `lock_detail` (the reasons
  in plain sentences), `lock_checked_at`, `created_at`, `updated_at`
  (kept by a trigger).
  - **It is private.** Row level security is on with no policy, and
    nothing is granted to `anon` or `authenticated`, so a browser query
    is refused for every account. The server routes read it with the
    service role, and `record_lesson_heartbeat` reads it because it is
    security definer. Never add a policy to it.
  - **Who writes it.** No code in the app puts a row in: rows arrive
    through the Supabase SQL editor, run there by a person. For a
    course lesson (an id shaped like `a3l07`) the row and the lesson's
    length come from one file, the video load (next point). For any
    other lesson a person puts the row in by hand and sets
    `lessons.duration_seconds` with it, as the morning kit does for its
    two test lessons.
    A lesson with a row here and no duration plays and can never be
    completed. The lock check writes `lock_status`, `lock_detail` and
    `lock_checked_at`, and only on a row that still holds the video it
    asked Tella about. Nothing a student can reach writes the table.
  - **How a lesson gets its written text (2026-10-14).**
    `supabase/diagnostics/load-lesson-text.sql` is a template in the
    same pattern as the video load below: a private filled copy,
    written by `clients/ecom-university/tools/lesson-text/` from the
    lesson pages of the Whop course, is pasted into the SQL editor and
    sets `description` on the listed course lessons (every lesson that
    has a text on Whop: the 9 action items until 2026-10-19, 62 lessons
    from then) and empties it on the others. v101 no longer writes
    `description`, so running it again keeps the texts. The lesson page
    shows the text under the video, or in the video's place when the
    lesson has none (`src/lib/world/lesson-text.ts`, `LessonText.tsx`).
    On production since 2026-10-14 with the 9 (9 listed, 9 changed);
    the 62 go in with the paste after v101 on the switch day. Only the
    newest filled copy is ever pasted: each states the whole list, so an
    older one empties every text added since. The texts stay out of the
    repository because they carry links to course assets.
  - **How a course lesson gets its video and its length.**
    `supabase/diagnostics/load-lesson-videos.sql` is a template: it
    holds no id and refuses to run as it is tracked. A tool that lives
    outside this repository (`clients/ecom-university/tools/tella/` in
    the owner's workspace) writes a filled private copy, one row per
    lesson with four columns (lesson id, the lesson's title, video id,
    length in whole seconds), and that copy is pasted into the SQL
    editor. The list is the whole truth for ids shaped like `a3l07`.
    The file writes those lessons' `lesson_videos` rows and their
    `duration_seconds` (on `lessons_next` and on `lessons`), removes
    the row of a course lesson that is not listed, empties
    `duration_seconds` on every course lesson that is not listed,
    whatever its type, and never writes a row or a length on any other
    id. It refuses, changing nothing, until v100 and v101 have run,
    when a title in the list differs from the title that lesson has in
    the catalog (so a list made for another version of the course
    cannot go in), and when a listed video already sits on a lesson
    outside the course. So for a course lesson `duration_seconds` has
    one writer, the load, and a course lesson has a length exactly
    when it has a video.
    `supabase/diagnostics/course-catalog-check.sql` is the read-only
    check to run afterwards: one row per area and a total, then four
    checks that should each read 0 (placeholder titles, video rows on
    unknown lessons, watch lessons with a video and no length, video
    rows on lessons that are not watch lessons). Neither file has been
    run on production (2026-10-13).
  - **Where the course's videos stand (2026-10-13).** In Tella 115 of
    the 141 lessons have a video. 15 are recorded elsewhere and have no
    video in Tella (`a3l11`, `a4l11`, `a7l01` to `a7l13`). 11 have no
    video anywhere yet: the five `setup` action items and `a7l14` to
    `a7l19`. A `watch` lesson without a video shows "Not recorded
    yet." The Tella API key reads every video in the workspace and
    changes only the videos uploaded from its own login. With it, 21
    of the 115 lesson videos were set to "Embed only" with the two app
    hosts (preview and production), downloads and comments off, and
    each was proved with requests: the proof is the tool's `check`
    (outside this repository), which on 2026-10-13 read "Locked and
    proven: 21. Not locked and proven: 0 that a key owns, 94 that no
    key owns" (course-catalog project log, Work Item 4). The other 94
    are still public until their creators' keys
    or an editor grant arrive. On 2026-10-19 `a4l11` Music Leverage got
    its video in Tella, uploaded from the key's own login, and `check`
    read "Locked and proven: 22. Not locked and proven: 0 that a key
    owns, 94 that no key owns": 116 of the 141 lessons have a video in
    Tella. Its row reaches the database only with the Tella tool's load
    of that day. Later that day `a3l11` Your Editing Software got its
    video too (the lengths file holds its 1750 s). Lovro decided that
    day that the 30% asks for every video up to the end of Video Ads
    II, whatever is there (decision 11 in the map review's
    `backend_readiness.md`), so with both rows loaded it asks for 61
    videos.
    The lock check judges every row by the
    same rule once someone runs it, so it reports a video that is
    still public as `open`.
  - **The rows are the database's only record of which video belongs
    to which lesson.** They are in no other table and never in the
    repository. For the course's lessons the same pairs are also in
    the Tella tool's private files, outside this repository.
    Two files that are run by hand refuse to destroy one: the undo
    stops while the table holds any row, and the stamp stops when a
    lesson it picked already holds a video it did not put there (both
    below).
  - **Why the id is not a column on `lessons`.** With Tella the id is
    the video's address. Every account that is signed in can read
    every column of `lessons` and `lessons_next` (their select policy
    is `auth.uid() is not null`), so an id stored there would reach
    every account, lapsed members included.
  - `lesson_id` has no foreign key, on purpose: until the cutover the
    table may hold ids from both `lessons` and `lessons_next`. The
    cutover adds none either: v104 copies the rows on ids the new
    course does not have (test stamps on old lessons) into
    `archive_v1` and deletes them, and leaves the course's own rows as
    they are (call C11). `student_lesson_watch` is treated the same
    way.
  - Unproven: whether production grants a new table to `service_role`
    by default, which the two routes and the lock check need. v100's
    commented post-check has a column for it
    (`service_reads_and_writes`) and the fix beside it.
- `quizzes` + `quiz_questions` — per-region quizzes
- `playbook_nodes` — Map 2 hub cards (3 rows as of v72:
  pb_submit_bounties, pb_build_portfolio, pb_apply_job_board). Each
  row's `article_slug` points at `public/playbook/<slug>/index.html`,
  a standalone HTML article the node sheet renders in an iframe.
  doc_content is no longer rendered. The pb_land_first_client
  milestone node was dropped (v72).
- `templates` — CSM DM templates (built-in + custom, with `trigger_config`)
- `admin_config` — key/value app config (program link, Discord invite, etc.)
  - v95 added the key `discount_window_days` (seeded `14`). No code
    reads it: the discount routes use `DISCOUNT_WINDOW_DAYS` in
    `src/lib/constants.ts`. It appeared as an editable row on
    `/admin/settings` until admin rebuild 2 removed that page; `PUT
    /api/admin/config` now refuses it with the other keys outside the 6
    of `src/lib/admin/config-keys.ts`.
  - `curriculum_reset_at` (written by v104, 2026-10-14 code, not on
    production): the moment of the course switch, in UTC, like
    `2026-10-20T18:25:00.000Z`. v104 writes it in the same transaction
    as the wipe and the copy, and its undo deletes it, so it cannot
    disagree with the data: no row means the old course is live. The
    CSM, achievements, the snapshot callers and floor, and the admin
    pages count from it. `PUT /api/admin/config` refuses it (400), and
    no admin page shows it since `/admin/settings` was removed (admin
    rebuild 2). Every reader is listed in system_contracts.md
    (`admin_config`).

**Student state (per-student rows — one table per function, v46)**
- `student_milestones` — onboarding + sprint progression
  (onboarding_completed_at, first_sprint_login_at,
  first_dashboard_login_at, intro_video_threshold_met,
  why_youre_here_panel_dismissed, bounty_access_claimed_at,
  first_client_landed_at, playbook_welcome_seen_at).
  Note: `first_client_landed_at` is dormant - the column persists but
  the API route, celebration component, and milestone node were all
  removed in v72.4. Safe to drop in a future migration if reclaimed.
  v103 adds `playbook_unlocked_at` (timestamptz, empty). v104 stamps it
  with the switch's moment for every graduate of the old course (a done
  l078, or done lessons numbering at least 80% of the old course's
  counting lessons, with no 30-day wait), and fills
  `first_sprint_login_at` from the earliest completion for students
  who have completions and no login stamp. The app never writes it. The
  data route's `select("*")` sends it to the browser, and the Playbook
  gate honours it (`isPlaybookUnlocked`, cutover WI-8, 2026-10-14).
- `student_streaks` — current_streak, longest_streak, last_streak_date.
  Written only by `tickStudentStreak`, on counted work (T-079). Every
  page that shows the streak reads it through `currentStreakAsOf`.
- `student_whop_sync` — Whop OAuth tokens + watch-history sync diagnostics.
  The tokens are written at each login and read by nothing (`refreshWhopTokens`
  has no caller), and nothing tells Whop about a lesson finished in the app:
  lessons travel from Whop to the app only (T-091).
  `last_sync_error` holds a failure, or the note "Whop returned N
  interactions but 0 marked completed" (lessons opened on Whop, none
  finished; `whopNoneFinishedNote` in `src/lib/constants.ts`), which the
  admin student page shows as a plain note, never in red. Whop returning
  nothing writes no error.
- `student_celebrations` — last_streak_milestone_shown,
  month_review_seen_at, celebrated_region_ids
- `student_dm_log` — outbound DM-sent flags (day28_dm_sent_at; extend
  as new DM flows ship)
- `student_lesson_completions` — watch + action shipping state per lesson.
  After v105 (built 2026-10-16, not on production) a student reads their
  own rows and writes none; the server writes them with the service role.
  `completed_at_real` (v112, built 2026-10-21, not on production): true
  when `completed_at` is the moment the lesson was really finished. The
  lesson page's player (`stampWatchCompletion`), Whop's event (the
  webhook) and the Whop catch-up with Whop's own time write it, each with
  a best-effort update after the row's own write; a login or visit sync
  never does (it stamps its own time on every row it adds). v112 judged
  the rows already there by the time itself: a `completed_at` another row
  of the same student also holds is a sync's (false), one no other row
  holds is true. Triple Threat reads it (`src/lib/achievement-rules.ts`).
- `student_lesson_watch` (v93): video watch telemetry, one row per
  student per lesson: `max_position_seconds`, `last_position_seconds`,
  `watched_seconds`, `reported_duration_seconds`, `heartbeat_count`,
  `first_played_at`, `last_heartbeat_at`, `threshold_met_at`. It is a
  measurement. The decision that a lesson is done stays in
  `student_lesson_completions`. Its only writer is the
  `record_lesson_heartbeat` SQL function (v93, tightened in v97,
  changed in v100), which the browser calls directly about every 15
  seconds of playback. The table has read policies only, so no client
  can write a row. There is no foreign key on `lesson_id`.
  - **`record_lesson_heartbeat` as v100 leaves it** (v100 has not been
    run on production). It is v97's text with five changes. A lesson is
    playable when it exists in `lessons` as a `watch` lesson and has a
    row in `lesson_videos`. Any other id is refused with `22023`. A beat after the first is
    credited at most 2.5 seconds of video for each second of clock
    since the beat before it, and at most 60 seconds in one beat. The
    first beat for a student and lesson has no earlier beat to be
    measured from, so it is credited at most 20 seconds. 2.5 is the top
    of Tella's speed menu, so a lesson watched at 2x or 2.5x can reach
    the 80% played floor, which it could not under v97. The same number
    is `WATCH_SPEED_CAP` in `src/lib/world/tella.ts`, and a client test
    reads the migration file to hold the two together. The fifth change
    is a lock. Right after it has found the student, each call takes
    `pg_advisory_xact_lock` on its own student and lesson for the
    length of its transaction, so calls fired at the same instant are
    served one at a time and only the first is credited. Without it
    each of them read the watch row before any had committed, and each
    was credited in full: three first calls fired together banked 60
    seconds, enough to complete a 67 second lesson. v97 has the same
    race. The race itself was never reproduced. The test database has
    one connection and cannot fire two calls at once, so the tests
    check that the lock is taken, with the right key, until the
    transaction ends, and they run the later callers' arithmetic one
    call after another. The lock is per lesson: several lessons run
    side by side are each credited 2.5 times the clock, and that is
    left open (tella-player project log, the 22:41 entry). The
    signature, the grants, the 5 second rate limit, the 95% stamp and
    the keys it returns are v97's.
- `daily_notes` — one row per student per day
- `lesson_notes` — per-lesson note
- `student_lesson_ratings` (v75): one rating per student and lesson: 1 to 5 stars and an optional comment, `created_at`, `updated_at` (moved by a trigger on every change). v104 archived and emptied it at the switch. Since v110 (admin rebuild 2, D10; to be pasted after the owner's look) students read their own rows and write none: `POST /api/student/rate-lesson` writes it with the service role; the team reads it through `GET /api/admin/lesson-feedback`.
- `student_quiz_attempts` — quiz attempts
- `student_rewards` + `hidden_rewards` — surprise reward system
- `month_reviews` — month-end student review
- `discount_requests` + `discount_feedback_questions` +
  `discount_feedback_responses` — discount flow
  - v95 added `discount_requests.gate_lesson_id` (text, no foreign
    key): the lesson that was the discount gate when the request was
    decided. No code reads or writes it yet.
  - v105 and v106 (built 2026-10-16, not on production): v105 drops the
    student insert policy, so a request (of any status) is written only
    by the server or the feedback form's function; v106 adds the unique
    index `discount_requests_one_pending_per_student` (`student_id`
    where `status = 'pending'`), so a second pending request is refused
    with 23505 and the first stands. Approved, applied and rejected
    requests are not limited.
  - v107 (built 2026-10-17, not on production): only the service role
    may call `submit_discount_with_feedback`, so a request is written by
    the server alone once v105 and v107 are in.
- `disengagement_alerts` — auto-generated churn alerts
- `tasks` — CSM task queue (per-student, per-scenario, links to
  `templates`). v85 added `outcome` (replied/no_reply/NULL, manual CSM
  tap on the Sent tab) + `outcome_at` + `outcome_by` — Phase 0 of the
  retention overhaul's feedback loop.
- `daily_progress_snapshots` — one aggregate row per DAY (PK `snapshot_date`), not per student. Written solely by the `rebuild_daily_snapshots` RPC since v89; values are point-in-time, derived from `first_paid_at` / `canceled_at`. v77 added cohort columns (`active_count_cohort`, `joined_count_cohort`, `churned_count_cohort`, `avg_progress_cohort`). After v75.51 (scope toggle removed), only the `_cohort` columns are read by the UI; the legacy non-cohort columns are still written for historical continuity. v89 made every past day point-in-time (was: recomputed from each student's CURRENT membership_status, which made the active line monotone and unable to show churn), bounded the rebuild with `p_end_date`, and made the RPC the SOLE writer — the snapshot cron now calls it instead of upserting its own values, so there is one definition of 'active'. `canceling_snapshots` remains the cron's, and the RPC cannot see it. v81 aligned the cron + RPC + dashboard avg_progress formula on the canonical isLessonComplete + l057 exclusion (single source of truth). v92 added the column `total_lessons`: the number of lessons with `counts_toward_progress` that `avg_progress` was divided by on that date (null on rows written before v92), and the RPC now decides "done" through the shared SQL function `lesson_is_complete`. v96 made the RPC executable by `service_role` only and made it raise when asked to start more than 30 days back. v103 puts a floor under the table: the trigger `trg_daily_snapshots_reset_floor` refuses (22023, "Nothing was changed.") any insert, update or delete of a row dated before the UTC date of `admin_config.curriculum_reset_at`, because such a row would be recomputed from archived progress as near 0%; with no such key it lets everything through. The switch day itself stays writable, so its row shows the drop, which is real. The three callers (the snapshot cron, `/api/admin/rebuild-snapshots`, `/api/admin/refresh-everything`) clamp their start to that date with `clampStartToReset()` and say "nothing to rebuild before the course switch" when nothing is left. A day missing before the switch stays missing.
- `student_membership_discounts` (v111, admin rebuild 2, D5; on production, where the coupon cron of the rule before T-122 has written its rows every 2 hours since 2026-10-21 11:37, with no `source`) — one row per student: what Whop said about their current membership when last read (`whop_membership_id`, `promo_code_id`, `promo_code` the code's name, `renewal_price`, `plan_renewal_price`, `discounted`, `checked_at`). `discounted` is the coupon check's answer: since T-122's third fix round a code other than the student's own 30% on a course membership or a course payment, or with no code anywhere a real payment in dollars under 97.00 that is no plan change, since its fourth the student's first real course payment alone and the memberships that no longer grant access read for a code too (until the third a promo code on the membership and a renewal below the plan's renewal price). A row counts only for the membership it was read from, or, when the student's Whop id on file is not a membership's, as that student's (T-122). v113 (T-122, 2026-10-21, branch `night/admin3`, not on production; THE RULE STAMP since its fifth fix round, 2026-10-22) adds `source`, the rule's version and the step that answered: `r5-membership`, `r5-user` (a course membership found through the Whop user, the one that carried the code when one did) or `r5-payment` (a course payment: one naming a code, since the fifth fix round one naming no code that came to less than its subtotal, the first real one under 97.00, or with no coupon the first real one, the newest until the fourth fix round; `renewal_price` then holds its price after discounts, the total less any tax added on top, in its own currency, and `plan_renewal_price` its subtotal when it names a code or shows a discount naming none, 97.00 when the price judged it, else empty, since T-122's third fix round), the step's word alone until the fifth fix round, which v113's check now refuses; and `source_checked_at`, the `checked_at` of the write that set `source`. Both are empty on rows written before, and on a no coupon judged without the user's list of memberships (a 404 or another 4xx for it, a 410 once v2 is gone); the code writes the row without them while v113 is not pasted. On a `membership` or `user` row naming no code `plan_renewal_price` is empty since the fourth fix round, which reads no plan for it. Since the third fix round a stored no coupon whose `source` is empty answers nothing when Whop gives no answer (the request routes' 503, and since the fourth the normal Approve's), since the fourth neither does one naming a code other than the student's own 30% by the promo id on their own request, since the fifth neither does one whose `source` does not carry this rule's version or whose `source_checked_at` is not its `checked_at` (a build that writes no source wrote over it), nor any stored no coupon while the student's own row cannot be read, and without v113 no stored no coupon does. Row level security: the team reads (`current_user_is_team()`); no policy writes, and a visitor's and a student's write privileges are revoked, so only the service role writes it (the cron `refresh-membership-discounts`, the discount routes and, since the render review's second round, `POST /api/admin/thirty/check-coupon`). Goes with the student (on delete cascade).
- `sync_runs` — audit log for the Whop community sync (v77). One row per attempt with source (cron / admin-button), status (success/failed), counts (fetched/inserted/updated/skipped/errors), duration_ms, error_message. Team-read RLS. Use to answer "did sync run last night?" without digging Vercel logs.
- `canceling_snapshots` (v84) — one row per day: how many launch-cohort
  paying students were in Whop's "Canceling" state at snapshot time.
  Written by the snapshot-progress cron; feeds the dashboard Canceling
  tile's trend line. DELIBERATELY separate from
  `daily_progress_snapshots`: the rebuild RPC deletes+reinserts that
  table and point-in-time canceling state can't be recomputed — a
  column there would be wiped on every "Refresh everything".

- `stats_saved_views` (v86) — saved tile layouts for the founder-only
  `/admin/stats` page. **No reader since admin rebuild 2 removed Stats
  (2026-10-20, branch `night/admin2`); the table, its policy and
  `current_user_is_stats_owner()` stay, with no migration.** Holds only WHICH metrics are on screen and how
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
- `etfb_team_links` (v87) — one row per free team-seat checkout link (a Whop
  plan under the Apex product), recording which BRAND OWNER it was minted for.
  **No reader or writer since admin rebuild 2 removed Brand Owners and its
  routes (2026-10-20, branch `night/admin2`); this table and
  `etfb_seat_decisions` stay, with no migration.**
  That fact exists nowhere else. Keyed on `plan_id`; `owner_whop_user_id` is
  **text and deliberately NOT a FK to `students`** — brand owners are not
  students and `students.whop_user_id` is UNIQUE. LOAD-BEARING partial unique
  index `one_active_per_owner` guarantees one active link per owner; without it
  a retried mint splits a team across two links and a later revocation misses
  half of them. An `archived` link can still hold live seats, so seat
  derivations must not filter by link status. Seeded with all 118 pre-existing
  links (2026-09-10): 66 matched by Whop username in the label, 22 by exact
  owner name (`confidence='confirm'`, flagged in the UI until a human agrees),
  17 because the owner had redeemed their own link, 2 by Discord handle, 1 by
  hand, 9 archived as never-used, 1 marked `out_of_scope` (the Evolve partner
  link `plan_t4VXohAMYT669`, 383 seats — a partnership, never a leak).
  The seed's rows hold owners' names, addresses and Whop user ids, so since
  2026-10-17 they are no longer in v87 (this repository is public); Lovro
  keeps them as they ran, and a database rebuilt from the migrations needs
  them run after v87.
- `etfb_seat_decisions` (v87) — a human override on ONE seat (`keep` /
  `snoozed`). PER-SEAT, never per-link. `revoked` is declared but never written
  by v1.
- `cron_runs` (v82) — audit log for the invocations of ALL seven cron routes. Captures route_name, started_at, finished_at, auth_status, status (running/success/failed/auth_failed), error_message, rows_affected. Written by every cron handler via `src/lib/cron-auth.ts`. Use to answer "did Vercel fire this cron in the last 24h?" — separable from sync_runs which only covers sync-whop.
- `achievements` — the badge catalog (v53 seeded 17; v56 deleted
  `streak_30`; the switch, v104, deleted the six old-course ones, leaving
  10 on production). v112 (built 2026-10-21, not on production) leaves 8:
  First Steps, Took the Shot, Through the Gate, Triple Threat, Habit
  Builder, Discount Earned, Perfectionist, Unbroken (the last two hidden in
  the corner's list until earned); it deletes Region Sweep and Two Weeks
  Strong and rewrites four sentences. `src/lib/achievements.ts` holds the
  8 rules. Tiers and order are v91's.
- `student_achievements` — per-student unlock rows + `achievement_unlock_stats`
  view exposing global unlock % (v53). After v105 (built 2026-10-16, not
  on production) a student can no longer insert their own badge rows
  (v55's "student writes own" policy is dropped); the server writes them.
  The view's denominator: from v90 the students who paid since 25 May,
  not CSM exempt, and used the app (v93 added a watch row as a use);
  since v112 every active member (membership `active` or `past_due`, not
  CSM exempt, not a team member: no `team_members` row with their
  sign-in), whether or not they opened the app, and the holders among
  them. Column types and `security_invoker=false` unchanged (v78, v90).
  v112 copied every badge row it took away into
  `archive_v112.student_achievements` (with why and when), with the
  catalog and the view as they were.
- `student_region_quiz` — per-(student, region) quiz_passed_at +
  quiz_attempts + best_score_pct + last_score_pct + last_attempt_at
  (v54 + v65). After v108 (built 2026-10-20, not on production) only
  the service role may call v55's `increment_region_quiz_attempts`,
  which writes any student's row and is called by nothing in the app. regions.quiz_format controls which mini-game wrapper
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
- The schema `archive_v1` (written by v104, not on production): the
  old course and every progress row the switch removed, one table per
  archived table (same columns, no constraints): `regions`, `lessons`,
  `student_lesson_completions`, `lesson_notes`,
  `student_lesson_ratings`, `quizzes`, `quiz_questions`,
  `student_quiz_attempts`, `student_region_quiz`,
  `student_achievements`, `achievements`, `student_milestones`, and
  the `student_lesson_watch` and `lesson_videos` rows on lessons the
  new course does not have. Plus the switch's own record: `meta` (the
  moment, who ran it, each table's row count), `stamps` (each student
  whose Playbook or first login it set), `csm_changes` (each template,
  task and alert it changed, with a copy of the row as it was),
  `constraints` and `not_nulls` (the keys and constraints it dropped,
  as Postgres stated them). Every privilege is revoked from `public`,
  `anon`, `authenticated` and `service_role`, so no API key reads it;
  only the SQL editor's owner does. The undo of v104 restores from it
  and renames it `archive_v1_undone_<yyyymmdd_hh24mi>`; it moves
  anything done on the new course into `archive_v2`. It is kept at
  least 90 days (call C18), then dropped by hand.
- The schema `archive_tasks` (written by v109, admin rebuild 2, D7, not
  on production): `reset_2026_10`, a copy of every task that was open
  when the tasks reset ran, every column as it was, with `reset_at`, the
  run's moment (equal to `admin_config.tasks_reset_at`). No privilege for
  `public`, `anon`, `authenticated` or `service_role`. The undo of v109
  restores from it and renames it `reset_2026_10_undone_<yyyymmdd_hh24mi>`.

**Undo files (`supabase/undo/`)**

A folder added on 2026-10-12. A file in it takes one migration back. It
is never run in sequence with the migrations: someone pastes it into
the Supabase SQL editor by hand, and only to undo.

- `2026_v100_undo.sql`: puts `record_lesson_heartbeat` back to v97's
  text and drops `lesson_videos`. It refuses to do either while the
  table holds a row: it stops before anything is started, says how many
  rows there are and changes nothing. Which lesson plays which video is
  recorded nowhere else in the database, so the way through is the one its message
  gives: save the rows somewhere private with the select it prints,
  delete them, and run the file again. The function text was copied by
  a script out of the v97 file, and the migration tests check that the
  database ends with the function it had straight after v97, character
  for character. That function has no lock and no 2.5x credit. Run the
  undo only together with putting the app back on the build from before
  Tella: the Tella build's routes read the table it drops. Watch rows
  and completions are left as they are, and v100 can be run again
  after it.
- `2026_v101_undo.sql`: puts v94's placeholder seed back into the
  staging catalog, the 8 placeholder area names and the 145 placeholder
  lessons. It is generated by `npm run build:catalog` together with
  v101 and never edited by hand. Its seed statements are copied by the
  script out of the v94 file, and the migration tests (section 20)
  check each copy against that file character for character. It
  refuses while a `lesson_videos` row or a `student_lesson_watch` row
  points at an id shaped like `a3l07`: it stops before anything is
  started, gives the two counts and no video id, and changes nothing.
  It leaves `lessons` and `regions` alone, and on `regions_next` the
  three columns v99 filled. A second run ends in the same state, and
  v101 can be run again after it. Since 2026-10-14 v101 itself refuses
  once `curriculum_reset_at` exists ("The course is live in
  public.lessons since the switch of ...; this file changes only the
  staging tables. Nothing was changed."), because after the switch it
  would change only the staging tables and look like it worked (call
  C20). A course change after the switch has no generated path into
  `lessons` yet (tasks.md).
- `2026_v103_undo.sql`: drops the snapshot floor (trigger and
  function), the view `student_last_counted_completion` and the three
  columns v103 added. It refuses while `curriculum_reset_at` exists:
  the live course needs them, so the undo of v104 goes first. Run it
  only together with putting the app back on a build from before the
  cutover code, which reads the view and the column.
- `2026_v104_undo.sql`: takes the switch back in one transaction. It
  moves every row made on the new course (completions, notes, ratings,
  quiz rows, badges, watch rows) into a new schema `archive_v2`, drops
  the six RESTRICT keys and the Whop index, puts the old catalog,
  every relaxed constraint, the six retired badges, every progress row
  and the old watch and video rows back from `archive_v1`, re-adds the
  keys under the names and definitions the switch recorded from
  production, takes back its Playbook and login stamps (only while
  they still hold its value) and its CSM changes (a task reopens only
  where no open task now exists for the same student and scenario),
  deletes `curriculum_reset_at` and renames `archive_v1`. It refuses
  with no `curriculum_reset_at`, with `archive_v1.meta` missing or
  disagreeing, with `archive_v2` already there, or when the keys are
  not the six it made. It leaves in the archive, and counts, rows of
  students deleted since the switch and old video rows whose id another
  lesson now holds (expect 0 and 0); a re-enabled template shows the
  undo's time as its `updated_at`; snapshot rows written after the
  switch stay. Then the Vercel values go back and the app is
  redeployed (the PRD's ship order, "Rollback"). The switch can run
  again after it. Once the week-later deletion (cutover WI-12) has
  merged, an undo needs that commit reverted first.
- `2026_v105_undo.sql` (2026-10-16, not run anywhere but the migration
  harness): drops the read policy v105 added and puts back every student
  write policy v105 dropped, exactly as `v105_record.policies` recorded
  them from production's catalogue, then drops that schema. It opens the
  back doors again. It refuses with the record missing or a policy
  already back under another definition.
- `2026_v106_undo.sql` (2026-10-16, the same): drops the index
  `discount_requests_one_pending_per_student`; no row changes, and a
  student can again hold two pending requests.
- `2026_v107_undo.sql` (2026-10-17, the same): puts back v29's
  `submit_discount_with_feedback` word for word and its grant to
  `authenticated`. Only with code that calls the function with the
  student's session (`main` before Monday's merge): `world-engine`'s
  route calls it with the service role, which v29 refuses, so with that
  code live every questions form would answer `SAVE_FAILED`.
- `2026_v108_undo.sql` (2026-10-20, the same): drops
  `increment_region_quiz_attempts` and makes it again from v55's own
  text, so it comes back with exactly the grants v55's run gave it (v55
  wrote no grant line: they are the database's defaults). It reopens the
  back door.
- `2026_v109_undo.sql` (2026-10-20, admin rebuild 2, D7): opens the
  tasks the reset dismissed again from `archive_tasks.reset_2026_10`
  (status, `dismissed_at`, `dismissed_by` and notes as they were), only
  where a task is still exactly as the reset left it and no open task of
  the same student and scenario exists now (the crons open those again);
  it counts the ones it leaves and why, deletes `tasks_reset_at` and
  renames the copy, so v109 can run again. With no `tasks_reset_at` it
  changes nothing.
- `2026_v112_undo.sql` (2026-10-21, the badges for the new course; not
  run anywhere but the migration harness): puts the catalog back from
  `archive_v112.achievements` (Region Sweep, Two Weeks Strong and every
  column of the others), every badge row v112 took away (each badge once,
  at its first time, skipping a student deleted since or one who holds it
  again), and `achievement_unlock_stats` as it was (its query, options and
  comment from `archive_v112.view_before`); keeps every
  `completed_at_real` value in the archive, drops the column, and renames
  `archive_v112` to `archive_v112_undone_<time>` so v112 can run again.
  With no `archive_v112.runs` it changes nothing.
- `2026_v111_undo.sql` (2026-10-20, admin rebuild 2): drops
  `student_membership_discounts` with its rows. The request and approve
  routes still ask Whop themselves; the map stops showing the coupon line
  and the admin page says it cannot read the coupons. The cron's entry in
  `vercel.json` would then fail on every write until v111 is back.
- `2026_v113_undo.sql` (2026-10-21, T-122; not run anywhere but the
  migration harness): drops `student_membership_discounts.source` with its
  check and, since T-122's fifth fix round, `source_checked_at`, every row
  and every other column kept. The cron and the discount routes then write
  each row without them, as before v113, and the request routes' fallback,
  finding no source, answers only a stored coupon (a stored no coupon gives
  their 503 when Whop does not answer, and since T-122's fourth fix round
  the normal Approve's refusal). Safe to run twice, and with the table gone
  too.

- `2026_v110_undo.sql` (2026-10-20, admin rebuild 2, WI-7; not run
  anywhere but the migration harness): puts back v75's two student write
  policies on `student_lesson_ratings`, `students_insert_own_ratings`
  and `students_update_own_ratings`, from v75's own text. It reopens the
  door v110 closed. Safe to run twice.

**The morning kit (`supabase/diagnostics/`)**

Three files for the first proof on production, pasted into the SQL
editor by hand in this order. The video ids are pasted over the
placeholders in the editor. The files are never saved with an id in
them, and neither their results nor their own error messages show
one.

- `stamp-tella-test-lessons.sql`: puts the two test videos on the two
  live `watch` lessons fewest students have completed, sets their
  `duration_seconds` to 67 (the length of both test videos) and ends
  with the two `/world/...` paths to open. It takes back any earlier
  run of itself first, and it stops and changes nothing while a
  placeholder is left in. It also stops and changes nothing when a
  lesson it picked already holds a video that is not one of the two
  test videos. It no longer replaces a video it did not put there, and
  its message names the lesson and no video. To switch to two other
  test videos, run the unstamp with the old ids first.
  `old_watch_rows` in its result should be 0 on
  both rows; anything else means the lesson was watched before and the
  proof would not start from zero.
- `tella-proof.sql`: one select that writes nothing and needs no
  editing. Every watch row beside its completion: the furthest point,
  the seconds really watched, both as a share of the lesson's
  duration, the heartbeats, and `counted`. Run it before the unstamp,
  which changes the duration the shares are measured against.
- `unstamp-tella-test-lessons.sql`: finds the lessons by the two
  videos, puts each `duration_seconds` back (753 on the lesson that
  carries the Bunny test stamp, empty on any other) and deletes the two
  `lesson_videos` rows. It is run before the cutover. A commented block
  at its foot deletes one student's own test watch rows and
  completions on the two lessons.

`stamp-test-lesson.sql` and `pick-test-lesson.sql` belong to the Bunny
player and open with a line saying they are superseded. The kit has run
only on the local test database, with fake ids (section 19 of the
migration tests). The SQL editor has not run it, and which two lessons
production picks is not known.

**The cutover's checks (`supabase/diagnostics/`, 2026-10-14)**

Both are read-only selects, pasted into the SQL editor, and both run
before and after the switch. Sections 23 and 24 of the migration tests
run them and check that every table count is unchanged afterwards.

- `cutover-preflight.sql`: what v104 will find and do, read from
  production, run after v101 and v103 and before the switch (ship
  order step 5). Its header lists its parts; as committed (`e07c0fd`)
  they are a. the keys into `lessons` and `regions` with their names
  (expect exactly six), what the switch relaxes, and any not-null
  column the copy would leave empty; b. every active template the
  switch turns off, with the conditions that make it (the list to read
  with Astrid and Karlo); c. the row counts the archive will hold;
  d. the graduates it stamps (by l078, by 80%) and the logins it fills
  in; e. the open tasks and alerts it dismisses; f. `lessons_next`
  (141 rows, 140 counting, gate `a4l17`, 141 distinct Whop ids, no
  placeholder title); g. whether v103 and v100 ran and whether
  `archive_v1` or the switch's row already exist. Since `9ffdec0` (review R4, R7):
  h. discount requests still pending (each decided before v104); i.
  requests rejected since the launch cutoff; j. active templates using
  `day_number`; k. the database triggers on every table v104 writes,
  against the six expected. v104's final table
  repeats b, d and e, to be compared.
- `cutover-postcheck.sql`: run right after the switch, the next
  morning and through the first week (steps 13 and 15). One row per
  check with a verdict (PASS, LOOK, INFO, NOT SWITCHED, NOT CHECKED):
  the switch's row and `archive_v1.meta` agree, the catalog equals
  staging, the six keys are RESTRICT and no other key points at the
  catalog, the Whop index, every archive count, no graduate without
  the Playbook, no retired badge back, no course task or alert from
  before the switch open again, the floor in place. Then INFO: open
  tasks created since the switch by scenario (no `nolessons`, `noship`
  or `pace` before course day 3), heartbeats, completions, and Whop
  syncs since the switch with what they fetched, matched and could not
  match. It reads `archive_v1` in a block before the select, so it is
  pasted and run in one go. At its foot, commented out, is the one
  statement that stamps the Playbook for a named student by hand.
- `admin-health.sql` INVARIANT 6 counts the lessons with
  `counts_toward_progress` (every lesson but `l057` on the old course,
  every lesson but `a7l19` on the new) where it excluded the id `l057`,
  so it holds on both courses.

**The Whop sync read (`supabase/diagnostics/whop-sync-proof.sql`, 2026-10-19)**

Read-only, one select, for one account named by its email. It came from
Lovro's preview review: two lessons finished on Whop that the preview
never showed. Until v104 both Whop paths (the webhook and the backfill)
look a lesson up in `lessons`, which holds the old course, and a
completion can only point at a row of `lessons`, so a new-course lesson
finished on Whop is recorded nowhere: the backfill keeps its Whop id in
`student_whop_sync.last_sync_unmatched` and the webhook answers 200 "no
lesson mapped". The read shows which course `lessons` holds, the
account's last backfill (fetched, matched, unmatched, its note or
error), each unmatched Whop id placed in `lessons_next`, and the
account's completions, each marked when it came after the last backfill
(with no tab open, only the webhook writes then). Its header carries the
switch evening's check, ship order step 11 in two. Section 28 of the
migration tests runs it before and after v104.

**The Whop catch-up's check (`supabase/diagnostics/whop-catchup-proof.sql`, 2026-10-20)**

Read-only, one select, counts only, pasted into the SQL editor after the
catch-up's write passes (`POST /api/admin/whop-catchup`, T-089), with the
`run_started_at` of the first write answer on the line marked HERE. Ten
lines, a to j: the active members, those read from Whop since the run
began and those not (c), Whop read failures since then (d, logins and
visits: the catch-up writes none), members whose sync row says they
finished lessons the app does not hold (e), unmatched Whop lessons (f),
watched lessons dated before the switch (g, above 0 because the
catch-up's rows carry Whop's times), the CSM pool logged in with still
no lesson (h), streak rows changed with no work that day (i) and "came
back" tasks (j). c, e, f, i, j and h's second number read 0 after a good
run. It has no section in the migration tests; on 2026-10-20 it ran on
PGlite over `migration-tests/base.sql` with made-up rows: ten lines as
its header says after a good run, and each planted fault on its line.

**The first-paid repair's check (`supabase/diagnostics/first-paid-repair-proof.sql`, 2026-10-20)**

Read-only, one select, counts only, pasted into the SQL editor right
before the repair's write (`POST /api/admin/first-paid-repair`) and again
after it. For every student with a Whop id: how many hold a
`first_paid_at`, how many first paid before 1 October 2026 (Croatia), from
1 to 8 October and from the 9 October launch on (all, and active or
past_due), and the 30% today for the active or past_due ones as
`discountWindow` reads the date (closed with no first payment, closed
before 1 October, open until the end of 23 October, open for its 14 days,
ended). Its header says which line moves by which of the write's counts.
It has no section in the migration tests; on 2026-10-20 it ran on PGlite
over `migration-tests/base.sql` (with a `whop_user_id` column added) and
11 made-up students, the boundary moments included: lines a to e as
counted by hand, and its 30% lines equal to the real `discountWindow` on
the same rows, at that day's clock and with `now()` set to 25 October.

## Cron Jobs (Vercel)

| Job | Cadence | What it does |
|-----|---------|-------------|
| `sync-whop` | every 2h at :00 (v85.5, was daily) | Syncs Whop memberships (`runWhopCommunitySync`); it pulls no lessons (this row said it pulled watch history into `student_lesson_completions` until 2026-10-17; the code has no lesson step). Also stamps `students.cancel_scheduled_at` from Whop's `cancel_at_period_end` field (v75.46). 2h cadence exists FOR the cancel flag: cancel click → save task within ~2h15m instead of up to 24h. **v85.6:** a user holding several memberships is deduped by ACCESS first, `created_at` recency only as a tiebreak within the same access class (`grantsAccess` in `src/lib/whop-members.ts`). Was recency-only, which let a dead duplicate outrank a live membership and hard-block a paid student on every run. **2026-10-20:** between memberships that grant access, active before past_due, then the course product's before an ETfB or Apex one, then recency (`outranks`, `isEtfbOrApexProduct`), so a paying student who takes a newer Apex seat stays on the paying plan, and one whose course renewal failed keeps the app on an active seat. The login's self-heal and the webhook's lookup pick by the same order (the Whop webhook entry above). |
| `snapshot-progress` | daily 00:30 UTC (deliberately NOT 2h) | Writes yesterday+today rows to `daily_progress_snapshots` + the daily Canceling count to `canceling_snapshots` (v76). Daily-grain by design — one row per day. Reads canonical `student_progress_counts` view (v75.28) so dashboard live values match snapshot trend values. |
| `check-engagement` | every 2h at :10 (v85.5) | Detect churn signals → `disengagement_alerts`. With `engagement_alerts_enabled` on, posts the new ones to the team's Discord, since 2026-10-20 one message per embed of at most 4096 characters (one embed for every alert was refused from about 22 on); a post that fails marks the run failed in `cron_runs` with the reason. The two toggles are read before the insert, and a failed read stops the run with nothing written (2026-10-20). An open alert is never posted again: one whose post did not go out stays unposted, and nothing closes an open alert, so a student is flagged once per type (open, the choice is Lovro's). |
| `check-csm-tasks` | every 2h at :15 (v85.5) | Evaluate `templates.trigger_config` → `tasks`. Includes auto-dismiss for orphan tasks (v75.19). v85.1: 3c also dismisses any non-canceling-aware open task for a canceling student ("save-the-sale flow owns this student"). |
| `check-na-tasks` | every 2h at :20 (v85.5) | Not-Activated escalation (Day 3/5/7/10) |
| `refresh-membership-discounts` | every 2h at :40 (admin rebuild 2, D5; branch `night/a2-thirty`; on production by the rule before T-122, writing rows with no `source` every 2 hours since 2026-10-21 11:37; T-122 and its fix rounds are on `night/admin3`) | Stores, per student whose 30% window is still open (`discountWindowOpen`, since the render review's fix round) and per student holding a pending request whatever their window or membership (since its second round), with no approved or applied request, whether they already have a coupon (`student_membership_discounts`, v111). Since T-122 (branch `night/admin3`) every one of them gets a yes or a no unless Whop does not answer, since its third fix round by the owner's rule as he put it (a code other than the student's own 30% on the membership on file, on any course membership found through the Whop user or on any course payment, the $0 ones too, then the price of a real payment in dollars that is no plan change; since its fourth fix round the memberships that no longer grant access read for a code too, and the price that of the first real course payment alone; since its fifth a payment naming no code that came to less than its subtotal a coupon too), counted by that step in `by_source`, with `user_list_unusable` and `refused_by_price` since the fourth and `refused_by_subtotal` since the fifth. Every row it writes carries the rule's stamp (v113's `source`, `r5-` and the step, and `source_checked_at`), but a no coupon judged without the user's list, stored with no source. In order: the preview's dry run, the deploy of the fifth fix round's build, v113 pasted, then the write runs until `left` is 0, before anyone approves, so every stored row is that rule's. Pinned to `iad1`. A run that cannot read the window or the pending requests, cannot write, has every Whop read refused, or in which Whop answered no read before the time ran out, ends `failed` in `cron_runs` and answers 500. `?mode=dry` (with the cron secret) reads Whop and writes nothing: the first look after a deploy. |
| `day28-dm` | NO cron trigger (removed pre-v85; route retained) | Day-28 Discord DM route still exists for manual/preview fire, but nothing schedules it — the platform currently sends zero automated student DMs. |
| `check-lesson-videos` | NO cron trigger (built 2026-10-12; it has never run for real) | The lesson video lock check. It reads every row of `lesson_videos`, longest unchecked first, and asks Tella's API for each video's settings: one request per video, each started at least 700 ms after the one before, each given up after 10 s. It judges the answer with `judgeLock` against `TELLA_EMBED_DOMAINS` and against the catalog (the lesson's `duration_seconds`, and whether a `watch` lesson with that id exists at all). It writes `lock_status`, `lock_detail` and `lock_checked_at` on the row, and only on a row that still holds the video it asked about. It stops asking 270 s after it started, 30 s before Vercel would kill the function, and reports what it has: the videos it did not get to are counted as `notReached` and are the first ones asked about on the next run. It posts one message to the team's Discord channel (`postTeamAlert`) when any lesson has a problem, and also when the run was partial: videos not reached, or a catalog table it could not read. Such a run ends as `failed` in `cron_runs`, with a message saying what was left. It trusts nothing it stored: every run asks Tella about every video again. A video Tella could not be asked about becomes `error` and the run carries on. It answers 500 "Lock check not configured" when `TELLA_API_KEY` or `TELLA_EMBED_DOMAINS` is missing. It runs only when someone calls it with the cron secret. Two things would switch it on, and both wait for Lovro's decision: a line for it in `vercel.json`, and both values set on the deployment that runs it (the PRD's ship order puts `TELLA_EMBED_DOMAINS` on Production). How many videos fit in one run is arithmetic from the route's header and was never measured on Vercel. The header reckons with 145 videos, the size of v94's placeholder course; the real course has 141 lessons and 115 of them have a video in Tella (2026-10-13), so a full load is fewer rows than that. At 0.7 s a video, the pace the spacing allows, 145 take about 100 s and about 385 fit. At about 1.4 s a video (two requests timed from a laptop at 0.9 s and 1.5 s, the write assumed at 0.2 s) they take about 3 min 25 s and about 190 fit. On a day when every request runs into its 10 s limit, 27 are asked and the rest are reported as not reached. 145 fit as long as Tella answers in about 1.6 s or less on average. `node world-tests/lock-check-sim.mjs` runs the route's own logic against stand-ins (see Testing). |

v85.5 chain each 2h cycle: sync :00 (fresh cancel flags + completions,
worst case done ~:05) → engagement :10 (alerts) → csm-tasks :15 →
na-tasks :20. Offsets are load-bearing — csm-tasks needs the sync's
cancel flags and engagement's alerts from the SAME cycle.

Schedules live in `vercel.json`. All seven routes use the shared `verifyCronAuth` helper from `src/lib/cron-auth.ts` (v75.37) which trims whitespace from CRON_SECRET (defense against env-var-drift silent 401s) and writes audit rows to the `cron_runs` table on every invocation. Use `cron_runs` to answer "did Vercel fire this cron in the last N hours?" — separable from "did the work succeed?".

**On both courses (cutover, branch `world-engine`).** `check-csm-tasks`,
`check-engagement` and `snapshot-progress` read
`admin_config.curriculum_reset_at` on every run; with no row each
behaves as before (proved side by side for the CSM). A failed read of
it fails the run in `cron_runs` rather than guess which course is live,
and so does an empty `regions` table for `check-csm-tasks` ("regions
returned no rows; no student was judged"). Since 2026-10-20 (the bug
hunt's cron-2) the same holds for a failed read of the student pool,
the milestones or a student's completions in `check-na-tasks`,
`check-engagement` and `check-csm-tasks`, and of `check-engagement`'s
open alerts and its two Discord toggles and `check-csm-tasks`' past-due
canceling students: the run fails in `cron_runs` and writes nothing. The
two reads by a pool-wide list of ids go 100 ids at a time. What changes
after the switch is under [The course switch](#the-course-switch-cutover). The
runs to watch on the evening: the first `check-engagement`,
`check-csm-tasks` and `check-na-tasks` after the switch, and the next
00:30 snapshot (ship order steps 14 and 15).

**Manual triggers** (Karlo/team):
- "↻ Refresh everything" button (dashboard + `/admin/tasks`) → `/api/admin/refresh-everything` runs sync-whop, rebuild_daily_snapshots RPC, then 3 CSM crons in parallel (v75.22)
- One-time first_paid_at backfill: `/api/admin/backfill-first-paid-at` (v75.34) — accepts CRON_SECRET fallback auth for terminal use. Fills empty values only, from the first real payment since 2026-10-20; in id order, a pass followed by its `next_after` until `remaining` is 0 (no student started after 240 s).
- The first-paid repair: `POST /api/admin/first-paid-repair` (2026-10-20) — the one writer that moves a stored `first_paid_at`, to the first real payment; dry, snapshot, write (see API Routes).

## Where the functions run (deploy regions)

The database is in AWS `eu-west-1`, Ireland (read from its DNS address
against AWS's published ranges, 2026-10-19). Before this setting every
function ran in Vercel's default `iad1`, Washington, so each database
round trip crossed the Atlantic: about 70 to 80 ms each, measured from
Croatia, against a few ms from the same region. `vercel.json` sets
`"regions": ["dub1"]` (Dublin) for the whole project. Prerendered pages
and static files come from Vercel's edge as before, and the watch
heartbeat goes from the browser straight to Supabase, so neither moves.

Whop's API is in the US, so a route that calls Whop more times in a row
than it reads the database gets slower in Dublin, by about 75 to 90 ms per
Whop call. Five routes stay in `iad1` (seven since the speed work, eight
with the first-paid repair from the merge of production's `main` on
2026-10-20, five since admin rebuild 2 removed Brand Owners' two and
Stats' one, six with its coupon cron), each pinned by its own entry under
`functions` in `vercel.json`, keyed by its source path
(`"src/app/api/cron/sync-whop/route.ts": { "regions": ["iad1"] }` and so
on). Counted from the code (a batch run side by side counts once):

| Route | Whop calls in a row | Database trips in a row |
|---|---|---|
| `GET /api/cron/sync-whop` | one page per 50 memberships of each product in `WHOP_PRODUCT_ID`, 200 ms apart (78 pages for the main product on 2026-09-17), then up to 25 first-paid lookups, 200 ms apart | about 19 (the two `cron_runs` writes, `sync_runs`, the existing rows and the upserts in batches of 500), plus 1 for each first-paid date found |
| `POST /api/admin/sync-whop` | the same | the same, plus 2 for the team login |
| `POST /api/admin/backfill-first-paid-at` | at least 1 per student (up to 10 pages), 200 ms apart; since the first-paid fix it starts no student after 240 s and answers `next_after` for the next call (until then its header said a run may come near its 300 s limit) | 1 for the list (plus 2 for a team login), then at most 1 per student |
| `POST /api/admin/first-paid-repair` | every paid payment of the account, 100 a page, each page waiting for the one before (4 such chains side by side with `"lanes": 4`), at most 4 requests a second, none started after 240 s; the dry run's `walk.pages` says how many | 2 for a team login, the students (1 per 1000), the 30% requests of the students it would move (1 per 100), and for a write 1 per 8 students changed |
| `GET /api/admin/backfill-discord-ids` | 1 per student | 1 for the list, then at most 1 per student |
| `GET /api/cron/refresh-membership-discounts` (admin rebuild 2, D5) | 1 per student whose 30% window is still open or who holds a pending request, plus 1 per plan and 1 per promo code a run (cached); since T-122 1 per page of the student's list through their Whop user (at most 4) and 1 for each course membership on it that is not the one on file, until one names a code, and 1 per page of their payments (at most 10); since its third fix round (2026-10-22) the list and the payments are read for every student whose membership on file names no code, so most students cost 3 requests (the membership, the list, one page of payments; 2 until then) and one with a code on the membership on file 1 or 2 (the code's name once a run); since its fourth the list and the payments are read at the same time, the memberships that no longer grant access count among those on the list, a plan is read only for a membership naming a code (until then for any membership read, and for two or more on the list to order them), and a list whose first page names more than 4 pages costs that one page; since its fifth the memberships that no longer grant access are read all at once, after those that do, and no membership is read when `WHOP_PRODUCT_ID` names no course product; at most 4 requests a second, none started after 240 s, the rest left to the next run | the window and the pending requests (1 per 1000 each), the pending requests' students outside the window (1 per 100), the 30% already held and the stored rows (1 per 100 each), the two `cron_runs` writes, then 1 write per 25 students |

In Dublin `sync-whop` would gain about 6 to 9 s on its Whop pages and win
back 1.4 to 3 s on the database: a few seconds slower every 2 hours, and
"Refresh everything" waits for it. The other four are slower or no faster
there. For the repair it is the walk that has to finish in time: a walk
that has not ended by 240 s writes nothing, and in Dublin each of its pages
waits about 75 to 90 ms more. Its write can be slower in `iad1`, 1 trip per
8 students changed, and a write left over is finished by the next call.

Routes that call an outside service but read the database more stay in
Dublin: the Whop login callback (about 14 database trips, 4 or 5 Whop
calls, and since the first-paid fix 1 more, the first-payment read of at
most 2.5 s, while the row holds no `first_paid_at`; about 0.6 s faster per
login), `refresh-watch-sync` (8 to 11
against 1 or 2), `discounts/approve` (about 8 against 1), the Whop webhook (1 to 5
database trips per event; only a deactivation asks Whop first, 1 to 5
calls, and nobody waits for a webhook), `refresh-everything` (4 of its
own; its `sync-whop` call runs in `iad1`), the unscheduled
`check-lesson-videos` (per video 1 Tella request and 1 write, started at
least 700 ms apart, so the region hardly matters), and the check crons and
`day28-dm` (database reads with 1 or 2 Discord posts; `day28-dm` makes 2
Discord calls against 4 database trips per student). A new route that
calls Whop more times in a row than it reads the database gets its own
entry under `functions`; count both before choosing.

**How the pin works.** Vercel takes a Node.js route's region only from
`vercel.json`: a function's `regions` under `functions` override the
project's `regions` for the file it names (Vercel's "Configuring regions
for Vercel Functions", read 2026-10-20). `export const preferredRegion`
does nothing for these routes. `next build` writes it into
`.next/server/functions-config-manifest.json`, and Vercel's Next.js builder
throws it away (`getPageLambdaGroups` in `@vercel/next`, the same line in
4.21.6 and in 24.0.0, the latest on npm); Next's own documentation in this
version says regions on Vercel need `runtime = 'edge'`. Commit `dbdbaa9`
pinned with `preferredRegion`: a local `vercel build` of it (CLI 59.1.4,
`@vercel/next` 4.21.6) wrote no region for any of the seven functions, so
all seven would have run in `dub1`. With the `vercel.json` entries the same
build writes `"regions": ["iad1"]` into each one's
`.vercel/output/functions/.../.vc-config.json`, and no region into the
others, which take the project's `dub1`.

The key must be the route's exact source path, and nothing at build time
checks it: the Vercel CLI lets a `src/app/` key that matches no file pass
without an error, so a moved or renamed route would lose its pin in
silence. `client-tests/function-regions.test.mjs` (in `npm run
test:client`) fails when a key names no file, and when a route under
`src/app` exports `preferredRegion` outside the edge runtime.

Routes with the same settings share one function, so the pins made three
functions in `iad1` (read from that build): the two `sync-whop` routes
with `backfill-first-paid-at` (`maxDuration` 300); `etfb`, `etfb/links`
and `stats` (`maxDuration` 30), gone with those routes in admin rebuild 2;
and `backfill-discord-ids` alone. `backfill-discord-ids` is a manual run, where a cold start costs
one wait per run, and a re-run mostly asks Whop about students with no
Discord on Whop, which is a Whop call each and no write. The first-paid
repair's pin came after that build: its `maxDuration` is 300 too, so it
likely shares the first of those functions, and no build has been read
since it was added.

**Not yet seen on a deploy.** Check on a preview deploy before production:
the `x-vercel-id` header of any API response reads `edge::function::id`, so
an unauthenticated `POST /api/admin/sync-whop` (a 401) should show `iad1`
and `/api/auth/me` should show `dub1`. Two function regions need a paid
plan (Vercel allows Hobby a single region and Pro 5, and a deploy over its
plan's limit fails before its build); the plan was inferred from the
2-hourly crons and `maxDuration = 300`, not read in the dashboard.

## Key Libraries (`src/lib/`)

| File | Owns |
|------|------|
| `supabase-browser.ts` / `supabase-server.ts` | Client construction |
| `admin-auth.ts` | Team auth gate for API routes (`requireTeam`, with an optional role list). The Stats page's id allowlist (`STATS_ALLOWED_USER_IDS`, `isStatsOwner()`, `requireStatsOwner()`, v86) went with Stats in admin rebuild 2. |
| `whop.ts` / `whop-members.ts` / `whop-sync-runner.ts` | Whop HTTP + sync. v75.53: the sync self-heals NULL `first_paid_at` for active students on the paying plan, 25 a run; since the first-paid fix (2026-10-20) from their first real payment (`first-payment.ts`), and its upsert carries no `first_paid_at` (it used to take the earliest membership `created_at`, free plans included, and to move a stored date earlier). **v75.59 LOAD-BEARING: every upsert row carries the IDENTICAL full column set, preserving by VALUE — never reintroduce a conditional row key.** postgrest-js unions batch keys and PostgREST NULLs omitted columns on conflict-update (the 2026-06-11 wipe: 638 `first_paid_at` + 67 `whop_plan_id` + ~48 `cancel_scheduled_at` erased); a tripwire aborts the sync on any non-uniform key set. v75.60/61: `canceled_at` backfill tries past cycle-end, then past `expires_at` (refund revocations), then stamps the observation moment — a churned student can never stay invisible to the churn trend. Since 2026-10-17 the backfill's read of a student's Whop lessons (`fetchCompletedLessonsAsAdmin`) checks the `user_id` filter worked, as the membership reads in `whop-members.ts` do: a row for anyone else, or Whop still saying there is more after 5 pages, throws, so nothing is written and the sentence lands on the student's sync row. |
| `first-payment.ts` (the first-paid fix, 2026-10-20) | What `students.first_paid_at` is: a student's first real Whop payment, the earliest with status paid, `paid_at` set, a total above 0 and not fully refunded (substatus `refunded` or `auto_refunded`, or `refunded_amount` at or above the total; a partial refund counts) nor lost in a dispute (substatus `dispute_lost`, a reading taken 2026-10-20 that the owner has not ruled on), any product; none for a free member. A total that does not read is left out and counted apart (`bad_total`); a page on which no row has a buyer, or no row a total that reads, is a failed read (`bad_page`, `pageInShape`), so a shape Whop changed never reads as "no payment". `judgePayment` and `addFirstPayments` are the rule; `fetchFirstPaymentForUser` reads one user's payments (`GET /api/v1/payments?user_id=&status=paid&first=100`, every page, refusing with no date when a row names another buyer) for the login, the sync's recovery and the backfill; `walkFirstPayments` reads every paid payment once for the repair, in 1 lane or in 4 (`walkLanes`, by `created_at`, each lane's payments checked to be inside its stretch, a payment two lanes read counted once). Both send `Api-Version-Date: 2026-10-15-1` (the payments shape changed on 2026-09-02-1 and the key's own pin is older), make at most 4 requests a second (shared by a walk's lanes), wait out a 429 twice (a 429 pauses every lane) (Whop's seconds or 15, at most 30) and report a failure by its kind, never Whop's message. Since T-122 (2026-10-21, branch `night/admin3`) it reads one user's payments the same way for the coupon check (`membership-discount.ts`), since T-122's second fix round as `fetchRealCoursePayments` (it was `fetchLatestRealPayment`, the newest alone) and since its third (2026-10-22) as `fetchCoursePayments`: every payment the list gives among those for the course's products (one naming another product left out, one naming none kept), the $0 ones, the refunded ones and those whose total or `paid_at` does not read too (`real` says which are real payments under the rule above, so a $0 payment still never sets `first_paid_at`; until the third fix round only the real ones were kept), newest first by `paid_at` (else `created_at`, one with neither last), each with its total, product, membership and promo code (`product_id`, `membership_id`, `promo_code_id` in the pinned shape, nested objects in the older one), its `currency` (lower case, else its total's own; since the second fix round) and its `billing_reason` (since the third; `usd_total`, read in the second, no longer is), on the coupon check's key, pace (`Pace`, exported) and limits, since its fourth fix round at the same time as the user's list of memberships, the coupon check judging the price of the first real one alone; since its fifth a row naming no buyer is kept too, marked (`buyerNamed` false; it was skipped with no trace), which the coupon check reads for a code it names or a discount it shows, never for its price (the first-paid rule counts it apart as `no_user`); no `include_free` is sent, as the pinned list gives the $0 payments with the rest (Whop's changelog entry 2026-09-02-1, which T-122's third fix round named 2026-09-02, the entry below it: "Zero-amount payments are included, so the proxy's `include_free` is gone", and a proxy-only filter is a 400); since T-122's fix round also its `subtotal` and the tax its total carries on top (`taxOnTopOf`: `tax_amount` only when `tax_behavior` is `exclusive`; nothing when it is null, "no tax applied", 0 or `inclusive`; not known when it is missing or does not read, or when a tax above 0 comes with any other behaviour or none, which until the second fix round was read as on top), the names and their meanings from Whop's API reference for `2026-10-15-1`, in either shape. Nothing in it writes. |
| `first-paid-repair.ts` (the first-paid fix) | The run behind `POST /api/admin/first-paid-repair`: `planFirstPaidRepair` (the plan and its counts, pure), `countRequestEffects` (students whose 30% requests start or stop counting, through `requestCounts`, and those the new date opens the 30% to beside a live request that does not count, with their ids), `readRepairStudents`, `runFirstPaidRepair` (walk, students, plan, then dry, snapshot or the guarded write). |
| `whop-catchup.ts` (T-089) | The Whop catch-up behind `POST /api/admin/whop-catchup`: `readCatchupMembers`, `runWhopCatchup` (one call of a dry or write pass) and `takeWhopCatchupSnapshot`. It reads Whop through `fetchCompletedLessonsAsAdmin`, giving up a read still unanswered 285 s into a call (`CATCHUP_READ_LIMIT_MS`), and writes its own insert and finish, with Whop's times, so `watch-sync.ts`, the login, the visit and the webhook stay as they are. Since v112 a row it adds with Whop's own time is marked `completed_at_real` (best-effort), so Triple Threat counts it on that day; one given the run's clock is not, nor a row it only finishes. Since 2026-10-22 (branch `night/action-done`) a row of one of the seven action items finished with Done alone (`isDoneOnly`) carries the action half too where it has none: at the watch half's time on a row it adds or finishes, at Whop's time (`whopActionTime`) on a row that holds the watch half alone (a Done pressed first on `a5l08` or `a5l12` is kept, and a finish never writes over one pressed after its read), with `rows.actions_finished` (dry: `would_finish_actions`) and the change log's `actions_finished`, `[row id, action_completed_at]`, for every action half it wrote. |
| `pkce.ts` | OAuth PKCE helpers |
| `student-app-gate.ts` | The closed doors before the new course (T-078): `STUDENT_APP_CLOSED` and `STUDENT_APP_OPEN_FOR` (server only), Lovro's coming-soon words, `mayEnter` (the rule), `studentAppClosed`, `studentMayEnter`, `studentMayEnterAs`, `refuseWhileClosed` (student routes), `whopLoginMayProceed` (the callback) and `comingSoonMetadata` (the tab and link preview of the pages that can show the coming-soon page). Reads nothing while open. The team's surfaces never call it. |
| `csm-triggers.ts` | Trigger metric registry + evaluator. v76: `is_canceling` condition (cancel_scheduled_at + still active) available in the /admin/templates TriggerBuilder — powers the save-the-sale "Canceling" task template. v85.1: CANCELING SUPPRESSION — for canceling students every built-in trigger returns null (`snapshotIsCanceling` wrap on the registry) and `evaluateCustomTrigger` only matches configs referencing `is_canceling`; check-csm-tasks 3c + check-na-tasks reinforce it, so canceling students hold exactly one task: the save-the-sale one. Cutover WI-3 (branch `world-engine`): `buildStudentSnapshot` takes the live course (`regionOrder` from `regions`, `resetAt` from the switch; a caller that passes none gets r1..r4 and no switch) and adds `courseIsNew`, `dayOnCourse`, `daysSinceCourseStart`, `lastCountedCompletionAt` and `activity`. See [The course switch](#the-course-switch-cutover) for what changes after it. |
| `csm-events.ts` | CSM event hooks (called from mark-* routes). v85.4: W2.2 + X.1 skip canceling students at creation; W2.6 (discount review) deliberately unguarded AND exempt from the 3c canceling sweep — a canceling student applying for the discount is a save signal. |
| `templates.ts` | DM template renderer (variable substitution) |
| `dm-toggles.ts` | The 4 automated-Discord switches in `admin_config` (`DmToggleKey`). `isDmEnabled` and `readDmEnabled` (with the read's error) are what the crons ask; only the exact text "true" turns a switch on, and the master switch must be on too. Since admin rebuild 2 the team sets them through `PUT /api/admin/config` (`admin/config-keys.ts`); the Discord test page and its `writeDmToggle` are gone, and `readAllDmToggles` (its reader of all 4, with no caller left) went in the render review's fix round: the Templates page reads the 4 with the 2 links (`readMessageSettings`). |
| `streak.ts` | `computeStreakUpdate` (a counted day's new values) and `currentStreakAsOf` (the streak shown: 0 once the last counted day is before yesterday, UTC). Its header holds the rule for a counted day (T-079). |
| `src/app/api/student/_lib/update-streak.ts` (not under `src/lib/`) | `tickStudentStreak` is the only writer of `student_streaks`, on counted work only. A failed read of the row writes nothing and logs `[streak] read failed` (it used to write 1 over the streak and the best); a failed write logs `[streak] write failed`. `markStudentActive` writes `students.last_active_at`. `updateStudentStreak` does both. Callers: `afterCompletionWrite` (lesson-watched, the Whop webhook), the backfill's two callers when it added rows (refresh-watch-sync, the login callback), mark-action-shipped and toggle-lesson. submit-quiz calls `markStudentActive` only. The Whop catch-up (`src/lib/whop-catchup.ts`, T-089) calls `tickStudentStreak` alone, for a lesson it adds that Whop says was opened today (UTC), when the member's streak does not count today yet (it reads `last_streak_date` first, and a failed read ticks nothing). |
| `quiz.ts` | Quiz scoring (legacy single quiz) |
| `region-quizzes.ts` | Region-quiz scoring + format dispatch (v54/v65/v69/v70) |
| `progress.ts` | Shared progress / completion derivations + `isPlaybookUnlocked` (the Playbook gate on either course: the switch's stamp, the unlock lesson, or 30 days and 80%; WI-8 2026-10-14, v75.16 before it) |
| `discount-feedback.ts` | Pure, but for one read. The discount application's questions: an unanswered answer per question type, `isAnswered` (a required one must be answered, spaces are no answer), `sortQuestions`, `toAnswers` (the body `/api/discounts/submit-feedback` takes). Read by the old dashboard's `DiscountFeedbackModal` and the map's `WorldDiscountForm`. Since the owner's review (2026-10-21; branch `night/admin3`) the server holds an application to the same rule: `unansweredRequired` (the required questions a sent application leaves unanswered, each answer read in the field its type takes) and `requiredAnswersRefusal` (reads the active `is_required` questions; null, a 400 with `UNANSWERED_REQUIRED`, or a 503 with `ANSWERS_UNCHECKED` when the read fails), which both request routes run before they write. |
| `whop-products.ts` (admin rebuild 2, D11) | `ETFB_PRODUCT_ID` and `TEAM_SEAT_PRODUCT_ID`, the ETfB-for-brands and Apex team-seat products, with the values `etfb.ts` held before it went with Brand Owners. Its first line says login-1 (`night/login1-main`) has its own copy in `whop-members.ts` and its `whop-product-setting.test.mjs` reads this file and checks that the copies agree (it read `etfb.ts` until the merge into `night/preview-2026-10-21` pointed it here), so an id changes in both files or in neither. |
| `admin/croatia-dates.ts` (admin rebuild) | (`admin/plans.ts`, with `planLabel()` and `YEARLY_WHOP_PLAN_IDS`, went in admin rebuild 2's review fix round: nothing read it once D4 dropped the plan pill. `PAYING_WHOP_PLAN_IDS` stays the charts' monthly-only set.) `dayLabel` "Fri 16 Oct", `deadlineLabel` "Fri 23 Oct, 23:59 (Croatia time)", `dayTimeLabel`, `clockLabel`, all in Europe/Zagreb. |
| `admin/thirty-data.ts`, `admin/thirty-view.ts` (admin rebuild; admin rebuild 2, D4 and D5) | The 30% page's list. `loadThirtyData` (server only, service role) reads every request made from 1 October, the students holding them, each one's rule inputs once for all of them, in pages and batches, and their stored coupons (`student_membership_discounts`); it hands each student the `DiscountReads` object `loadDiscountReads` would have made, and a failed read becomes that read's error for the students it covers, never an empty list (a failed coupon read is `coupons: { data: null }`, which the page says). Each read of completions holds as many students as fit in one page (16 at 61 lessons), so it is one query and a completion deleted during the load cannot shift another student's row out of it; the pending requests are read before the decided ones, and a request on both lists is kept once, as decided. Since D4 it reads no survey, no Tasks queue and nobody without a request. `buildThirtyView` (pure) runs `discount.ts` and `discount-server.ts` unchanged: on a pending request the stored coupon first (`couponVerdict`, the approve route's refusal), then the approve route's verdict; rows oldest first. `client-tests/thirty-view.test.mjs` proves both paths equal on every fixture, past 1000 rows. Since the review's fix round `readApprovedCoupons` asks Whop now about each student holding an Approved request (`readMembershipDiscount`, at most 6 s to start a read and 8 s for an answer, never throwing, writing nothing), `buildThirtyView` takes those answers as its 4th argument, and every row carries `couponCheck` (`live`, `stored`, `not-checked`, `failed` or `unread`: where its coupon came from). Since the render review's fix round (2026-10-21) the list's read takes each request's `whop_promo_id` (`LISTED_REQUEST_COLUMNS`), and a decided row's coupon carries `promoCodeId` and `ours`: the team's own 30% code (`isThirtyCode`: an ECOM30 code, or the request's own promo id), which no row warns about (`couponWarns`, an Approved row's warning only); `COUPON_REJECT_REASON` is the reason a coupon row's Reject starts with: since the render review's second round the map's own sentence to the student (`MEMBERSHIP_DISCOUNT_LINE`), where `couponRejectReason` gave the team's words naming the code. Since the owner's review (2026-10-21) `anywaySkip` says what Approve anyway skips on a row (`coupon`, `rule`, or `check` after the approve route's refusal of a verdict that said yes) and `approveAnywayText` is its confirm, naming it. |
| `membership-discount.ts` (admin rebuild 2, D5) | The coupon rule. `readMembershipDiscount`: `GET /api/v1/memberships/{id}`, the plan's renewal price (`GET /api/v1/plans/{id}`, once per plan per run) and the code's name (`GET /api/v1/promo_codes/{id}`, once per code), all pinned to `2026-10-15-1`, 4 a second, a 429 waited out and retried twice, inside a time budget; either shape of a price or an id. `isDiscounted`: a promo code on the membership and a renewal below the plan's, in cents (a lower price with no code is not a discount applied). `checkMembershipDiscount` (the request and approve routes): Whop now, then the stored row for this membership, then nothing (`source: "none"`: since the owner's review of 2026-10-21 the request routes refuse on it, `membershipUncheckedRefusal`, and since T-122's fourth fix round the approve route's normal Approve too, where it went on until then; its log line says "no answer is on file", where it said "nothing blocks"); a live answer is stored. `refreshMembershipDiscounts` (the cron). A failure is a kind, never Whop's words. Since the review's fix round `checkMembershipDiscount` logs a stored Whop id that is not a membership's (`not_a_membership`: Whop was not asked, and the stored row or nothing decides), and a cron run in which Whop answered no read before the time ran out is `ok: false` (it was `ok: true` with nothing checked). Since the render review's fix round (2026-10-21) `refreshMembershipDiscounts` reads the students whose 30% window is still open at its start (`discountWindowOpen`, `earliestOpenFirstPayment` in `src/lib/world/discount.ts`), active or past due, with no approved or applied request: a student whose window has closed can make no request. Since its second round it also reads every student holding a pending request, whatever their window or membership (`pending_requests` in its answer): the 30% page judges a pending row by the stored answer, and a row whose answer says a discount is on the renewal offers no Approve, so the approve route's own live read never runs for it and a stale answer stayed until this read. `checkMembershipDiscount`'s answer carries `saved` since then (Whop's answer now was written), which "Check Whop again" (`POST /api/admin/thirty/check-coupon`) needs. Since T-122 (2026-10-21, branch `night/admin3`) `judgeStudentDiscount` answers every student yes or no in three steps, the membership on file, the course memberships found through the Whop user (`findCourseMemberships`, v2's list by `user_id`, `courseProductIds`) and the latest real payment (`fetchLatestRealPayment` in `first-payment.ts`), and gives no answer only when Whop does not answer or the deployment cannot ask (`NoAnswer`, `isNoAnswer`). Since its fix round (the same day) every course membership found that grants access is read, a plan that renews above 0 first, and a discount on any one of them answers (until then the first in the order alone: `findCourseMembership`); a membership on file on a free plan with no discount hands over to them; and `paymentCoupon` judges the payment: a code on it that took money off (its total less any tax added on top, below its subtotal), a code whose subtotal or tax does not read, or that price under 97.00 (`paidUnderFullPrice`; until then the total under 97.00 alone); `checkMembershipDiscount` and `refreshMembershipDiscounts` run it (`via` on the check's answer, `by_source` and `no_real_payment` on the cron's), write `source` (v113) and write again without it on a database without v113 (`lacksSourceColumn`), and `storedRowApplies` lets the student's row count when the id on file is not a membership's; the `not_a_membership` log line went with it. A 4xx other than 401, 403, 404 and 429 is `http_4xx` (it was `http_other`, which now means a 5xx). Since its second fix round (the same day) step 3 runs whenever steps 1 and 2 show no discount, on every real course payment (`fetchRealCoursePayments`), any one on a coupon answering with the row naming that payment's membership, and the membership settled on answering when none is; a membership naming a code whose renewal price or plan does not read is a discount by itself (`readMembershipDiscount` hands back `unpriced` with `bad_shape` and `no_plan_price`); the team's own 30% code (`TEAM_THIRTY_CODE`, `isTeamThirtyCode`: an ECOM30 code, its name read) is never a coupon on a payment nor by itself on such a membership; and `paymentCoupon` holds a payment in another currency against 97.00 at its `usd_total`'s rate, by its code alone without one. Since its third fix round (2026-10-22) it is the owner's rule as he put it: a code other than the student's own 30% on any course membership read (on file, and through the Whop user every time, `lookAtMembership`) or on any course payment (`fetchCoursePayments`, the $0 ones too) is a coupon, and with no code anywhere `paymentCoupon` holds a real payment in dollars that is no plan change (`PLAN_CHANGE_REASON`, `subscription_update`) against 97.00; `isTeamThirtyCode` gave way to `isOwnThirtyCode` (the name `teamThirtyCodeFor` makes, which the approve route builds its code with, or the promo id on the student's own approved or applied request, read by `checkMembershipDiscount`); and the fallback answers a stored no coupon only when its `source` names a step (`isDiscountSource`; read again without it on a database without v113, where no stored no coupon answers). Since its fourth (the same day) `findCourseMemberships` hands back the course memberships that no longer grant access apart (`endedIds`, read by `lookAtMembership` for a code alone and never settled on), a v2 list in another shape, holding another user's row or naming more than 4 pages as no answer (`bad_page`, `filter_ignored`, `too_many_pages`), and a 404 or another 4xx for it as `unusable`, which the cron counts (`user_list_unusable`); `lookAtMembership` reads no plan for a membership naming no code and answers a body that is no JSON object as no answer (`bad_shape`, never kept); the user's list and the payments are read at the same time; the price judges the first real course payment alone (`firstRealPayment`, told `first_paid_at`), and the cron lists the students it alone refused (`refused_by_price`, from `byPrice` on the judge's answer); `isOwnThirtyCode` takes the name only while the student holds an approved or applied request (`holdsOwnThirty`, read with the promo ids by `checkMembershipDiscount`); the fallback answers a stored no coupon only naming no code or the student's own 30% by such a request's promo id (`storedNoCouponAnswers`); and the approve route refuses the normal Approve on a check with no answer (`couponUncheckedApprovalRefusal` in `discount-server.ts`). Since its fifth (the same day, the last) every row it stores carries THE RULE STAMP (`RULE_VERSION` `r5`, `storedSourceOf`, `STORED_SOURCES`: `source` the step with the rule's version, `source_checked_at` the write's own `checked_at`), but a no coupon judged without the user's list, stored with no source; the fallback answers a stored no coupon only with that stamp from one write (`stampedByThisRule`, `stampOf`; `isDiscountSource` is gone) and only when the student's row was read, and logs why a stored no coupon did not answer (no source, an older rule's, written over, a code, the student unread); `judgeStudentDiscount` stops before any read when `WHOP_PRODUCT_ID` names no course product, and `lookAtMembership` passes over a membership of another product (`other_product`, its `product_id`); a membership read answering an object of another id or naming no code field is `bad_shape`; a payment naming no code whose price is below its subtotal is a coupon (`discountWithoutCode`; the cron lists those students in `refused_by_subtotal`, from `bySubtotal` on the judge's answer); `firstRealPayment` takes the checkout (`CHECKOUT_REASON`, `subscription_create`), else the highest price, among the real payments at the first payment's moment, never a row naming no buyer; and the memberships that no longer grant access are read all at once. `client-tests/membership-discount.test.mjs` runs it on a stand-in Whop, with the routes (the check route too), the cron and the data route (the window and the pending requests on the suite's clock moved to 5 November too), since T-122 the user's list and the payments, since its fix round the payments' subtotal and tax and a user holding a paid and a free course membership, since its second fix round a section of its own (each case through the judge, both request routes and the cron, the controls, the team's 30% on the 30% page), 37 of whose 50 checks fail on the commit before, and since its third another (every case of the re-check through the judge, both request routes and the cron, the controls, the stored fallback with and without v113, the student's own 30% and the approve route's code), 64 of whose 84 checks fail on the commit before, and since its fourth another (the world-engine preview's stored row, the v2 list answering 410, 404, another shape, another user's row and 5 pages, a code on a canceled or expired membership, a later manual charge and add-on, the $1 and $5 first weeks, another student's ECOM30 code sharing 6 characters, a membership read answering a body that is no JSON object, the stored fallback by promo id, Approve on no answer and Approve anyway, and a no-code student at 2.5 seconds an answer), 52 of whose 76 checks fail on the commit before, and since its fifth another (one case per item of the round through the judge, both request routes, the normal Approve and the cron: the stored rows of an earlier round's build and of a build from before T-122, a student whose row cannot be read, a membership read wrapped, `{}`, with no code field or of another id, a payment naming no buyer, another product's membership on file, a 0.00, 873.00 and EUR 44.95 below their subtotals, the student's own 30% and a plan change, the checkout beside an add-on at one moment, two canceled memberships at 2.0 seconds an answer, the v2 list answering 410 and 404, and the cron's writes held to v113's check), 78 of whose 96 checks fail on the commit before. |
| `admin/admin-frame.ts` (admin rebuild 2, D1) | The admin's frame as data: `ADMIN_HOME` (`/admin`, where signing in, setting a password and the lockup go), `ADMIN_NAV` (the top bar's entries and their role flags), `entriesFor(role)`, `isActive`, and `isRebuiltPage(pathname, pages)` (which pages wear the dark look; `/admin` covers itself only). No React; `client-tests/admin-frame.test.mjs` checks it as it is. |
| `admin/config-keys.ts` (admin rebuild 2, D6) | The 6 `admin_config` keys `PUT /api/admin/config` writes (`EDITABLE_CONFIG_KEYS`: the 2 message links and the 4 Discord switches) and `configWriteError` (a switch only as "true" or "false"). For the Templates page's Message settings panel too. |
| `admin/admin-transport.ts` (admin rebuild) | The browser side of the 30% page: bearer calls to `GET /api/admin/thirty` and to approve, reject and mark-applied, and since the render review's second round of admin rebuild 2 to `POST /api/admin/thirty/check-coupon` ("Check Whop again", `checkCoupon`) (the ads tick's call went with the tick, 2026-10-20; Today's calls and Mark messaged's went with Today in admin rebuild 2). Since the owner's review (2026-10-21) `approve` sends `overrideCoupon` beside `override`. The dev page hands the view a stand-in instead. |
| `admin/tasks-reset.ts` (admin rebuild 2, D7) | The tasks reset as the admin reads it: `TASKS_RESET_KEY` (`tasks_reset_at`, written by v109 only), `getTasksResetAt` (throws on a failed read or a value with no zone, never answers "no reset" for one), `checkTasksResetAt` (the value check alone; since the review's fix round the Dashboard's `configReads` uses it too), `readTasksConfig` (the reset and the 2 DM links in one read, for `GET /api/admin/tasks`), `isAfterTasksReset` (a task on the lists or on Archived). No React; `client-tests/admin-tasks.test.mjs` and `admin-people.test.mjs` run it. |
| `admin/tasks-view.ts` (admin rebuild 2) | The Tasks page's rules, no React: `tabsFor` (Archived once the reset ran), `openTiers`, `historyGroups`, `closedLine` (how a closed task was closed, the reset's note in plain words), `waitingText`, `queueHealth` (sent today in Croatia), `insightsRanges` (since the review's fix round only "Since the reset" while the reset is under 30 days old). |
| `admin/people-common.ts`, `admin/students-list.ts`, `admin/student-detail.ts`, `admin/journey-board.ts` (admin rebuild 2, D8, D9) | The readers and builders of All students, a student's page (and the journey's drawer) and the journey. Each reader takes the team member's client and keeps every read's result apart (`Read`), so a page says what failed; each builder is pure and takes the course (`loadCourseActivity`) and the moment of the read. The populations, since the owner's answer of 2026-10-21: a first payment on one of the two $97 monthly plans, `MONTHLY_97_PLAN_IDS` (students; since the owner's review of the same day a first payment on or after `DISCOUNT_ELIGIBLE_FROM`, 1 October, with the pills `STATUS_FILTERS` Active, Payment failed and Ended); the same plans with a first payment on or after `DISCOUNT_LAUNCH_DATE` and a Whop membership active, past due or canceled (journey); every line drawn in the database, the plan a filter and never a column (from 2026-10-20 to then, any plan). Since the owner's review the per-student views (`student_progress_counts`, `student_last_counted_completion`) are read for the listed students alone, by id in batches of 100 (`readForStudents` in `people-common.ts`; `loadCourseActivity` takes the ids too), one failed batch failing the read, and the journey reads no username, booked cancel or area. The student read names its columns (no plan); the Whop sync read never the tokens. Since the review's fix round a failed read that still leaves a page is a `Problem` (`people-common.ts`: the page's sentence and the database's text apart, so the page says it in plain words with the text behind Details), and `student-detail.ts` also reads `admin_config.program_login_link` and makes the quick DMs (`quickDms`, `dmFirstName`) in the messages draft's words. Since 2026-10-22 (branch `night/action-done`) each of its action items carries the drawer's word, `status` (`actionItemStatus`: "Handed in", "Done" for one of the seven with nothing to post, `isDoneOnly`, or "Not yet"), and the seven's `link` is always null. `client-tests/admin-people.test.mjs` runs them on the stand-in database; `client-tests/done-only.test.mjs` runs the action items. |
| `admin/people-transport.ts` (admin rebuild 2) | The browser side of those pages and of Tasks and its insights, behind interfaces (`TasksTransport`, `InsightsTransport`, `PeopleTransport`) so the dev pages hand the same views a stand-in (`src/app/dev/admin/fixtures-people.ts`). Tasks and insights call their routes with `send` of `admin-transport.ts` (exported for this); the student pages read with the member's session, as before. `setExempt` asks for the row back, so a write row level security refuses says so. |
| `admin/metrics-definitions.ts` | Canonical predicates for admin metrics: `isActiveMember` (active + past_due), `isPayingMember` (active member on a `PAYING_WHOP_PLAN_IDS` plan), `isInLaunchCohort` (first_paid_at >= cutoff, NO joined_at fallback post-v75.28), `isMonth2Converted` (cohort student who reached day 30 and didn't cancel before then, v75.38/v75.42), `isInMonth2Cohort` (denominator companion), `isCanceling` (cancel_scheduled_at set + still active, v75.47). Scope-toggle helpers deleted in v75.51. `renewalResolvedMs` (the first renewal plus its grace) is exported for the Dashboard's Month 2 dates (admin rebuild 2). |
| `admin/dashboard-metrics.ts` (admin rebuild 2, WI-2) | The Dashboard's numbers as pure functions (D3): `monthTwo` (Month 2 over `isInMonth2Cohort` and `isMonth2Converted` for the students who first paid from the launch, or the waiting state with the first renewal's date and when the first rate can show), `bounty` (since the owner's review of 2026-10-21 with `previous14`, the stamps of the 14 UTC days before the window) and `bountyTrend` (the arrow: `up`, `down`, or null when equal), `active`, `canceling`, `churned`, `avgProgress` (one metric: the snapshot's `avg_progress_cohort`, read from the switch's date; since the render review's fix round on the 14 days' axis, the days before the switch empty, and `from` the switch's date when it falls inside the 14 days), `buildDashboard` (every tile from the reads; a failed read fails each tile it feeds) and `refreshSummary`, with the read adapters `rowsRead`, `countRead` and `configReads` (a failure is never an empty list or a 0; `tasks_reset_at` is optional and goes through `checkTasksResetAt` of `tasks-reset.ts`, the Tasks page's own check, since the review's fix round: it also took Postgres's own text, which the Tasks page refuses). No React, no database: `client-tests/dashboard.test.mjs` runs it as it is, and runs the page's `readDashboard` on a client that records every call. |
| `admin/read-failure.ts` + `components/admin/review-parts.tsx` (admin rebuild 2, the review's fix round) | A failed read in the team's words. `plainReadError` turns the database's or the route's text into one plain sentence (a timeout, a signed-out session, the network, a missing table or column, "This account can't read the admin settings." for a permission refused on `admin_config`, a busy or failing server; a sentence of our own passes as it is), `plainReadErrors` says each reason once, `hasDetails` says when the raw text says more. `review-parts.tsx` draws them in the dark look: `ReadFailure` (the plain sentence, the raw text behind a closed Details), `ProblemNotice` (a read that failed above a list that still shows), `FailureList` (several reads, one Details), `ErrorDetails` and `TextLink` (a header's link to another page, as Airy Blue words, 44px). Every rebuilt page's error and problem lines use them; `client-tests/admin-review.test.mjs` checks the sentences and the pieces. |
| `admin/discount-status.ts` (admin rebuild 2, the review's fix round) | The 30% request statuses in the admin's words and colours, one place for the 30% page's tabs, a student's page and the Survey: `DISCOUNT_STATUS` (pending Applied, approved Approved, rejected Rejected, applied Code Applied), `DISCOUNT_STATUS_ORDER` (that order) and `discountStatusWords` ("Unknown status (x)" for a status it does not know). |
| `supabase-pagination.ts` (v75.27) | `fetchAllRowsPaginated(thunk)` calls `.range(0,999)`, `.range(1000,1999)`, etc. until a page returns less than 1000 rows. Bypasses PostgREST's silent server-side max-rows cap. Returns empty data on error (not partial) so silent truncation can't sneak through. EVERY bulk fetch on admin surfaces should use this. `fetchAllRowsByKey(thunk, key)` (admin rebuild, 2026-10-20) pages by a unique key instead (`key > last`, `limit 1000`): a row deleted or leaving the filter between pages cannot shift another out of the read; Today uses it for its long reads. |
| `cron-auth.ts` (v75.37) | `verifyCronAuth(request)` + `logCronStart`/`logCronFinish` — shared auth check (whitespace-trimmed against drift) + audit-log writes to `cron_runs`. All 7 cron handlers use this; replaces the per-route inline `Bearer ${process.env.CRON_SECRET}` check. |
| `csm-task-evaluation.ts` (v75.21) | `reEvaluateStudentOpenTasks(supabase, studentId)` — real-time auto-dismiss helper called from toggle-lesson / mark-action-shipped / skip-lesson API routes. Re-evaluates each open task's trigger against the student's CURRENT state and dismisses any that no longer apply. Same evaluation logic as check-csm-tasks section 3c but scoped to one student. |
| `outreach-insights.ts` (v85.3) | `computeOutreachInsights(supabase, {sinceIso, tasksFloorIso})` (`tasksFloorIso` since admin rebuild 2, D7: only tasks created on or after it are read; the Tasks insights route hands it `tasks_reset_at`, the Templates strip nothing) — single source of truth for outreach effectiveness. `familyOf(template)` maps scenario prefix / is_canceling trigger / bucket → family; each family graded on what its message asks (see /admin/tasks/insights row above). Evidence: lesson+note events (activity families), student_milestones.first_sprint_login_at (stalled), current students state (canceling saves). Also: replied/no_reply/unmarked, median time-to-send, students_reached (unique). Excludes admin-only + untemplated tasks. Per-metric range filtering. Used by /api/admin/tasks/insights + /api/admin/templates/stats (strip shows "% success"). |
| `achievements.ts` | Achievement catalog + unlock evaluation (v53). Cutover WI-4: the areas come from every lesson's `region_id` (lessons outside the count left out by `counts_toward_progress`), so `unbroken` and `perfect_run` count whichever course is live, and the day number counts from the later of first payment and the switch. A failed read of the switch skips the check that once (it under-awards, never over-awards; morning review T1). v112 (2026-10-21, `night/achievements`) leaves 8 rules: the six tied to r1..r4 or the 30-day clock, Region Sweep and Two Weeks Strong are gone. Habit Builder counts the streak's days from the switch's date (`streakDaysSinceSwitch`; with no switch the old rule, current or best 7), and Triple Threat the lessons really finished on one UTC day (`mostFinishedInOneDay` over `completed_at_real`, read in a read of its own, so a database without the column still judges every other badge); both rules are in `achievement-rules.ts`. Discount Earned, after the switch, counts the approvals the map shows (`discount.ts` `requestCounts`): one made from 9 October on, or (T-080) an old-dashboard one of a student who first paid from 1 October (9 September until 2026-10-19) until the launch. Before the switch any approval counts, as it always did. |
| `achievement-rules.ts` (v112) | The badge rules that need more than a line, with no imports so the client tests and `supabase/migration-tests/v112.test.mjs` run the file itself: `finishedAt` (when a lesson was really finished: `completed_at` when `completed_at_real`; an action item at its second half, its action's own time when the video half was already in; else null), `mostFinishedInOneDay` (Triple Threat's count per UTC day), `streakDaysSinceSwitch` (Habit Builder: the current run's days on or after the switch's date), and the share the view `achievement_unlock_stats` computes, written here so its test holds the SQL to it: `countsInShare` (membership active or past_due, not CSM exempt, not a team member) and `sharePercent` (Postgres's round to one decimal, half up). |
| `discord.ts` | Discord HTTP helpers |
| `day28-embed.ts` | Day-28 DM embed builder |
| `titles.ts` | Student title progression. `getTitleForRegions(count, totalRegions = 4)` and `getNextTitle`: a rung needs `minRegions × totalRegions / 4` areas, so on eight areas the ladder is 0, 2, 4, 6, 8. An area count that is not a positive number (areas not loaded yet) gives Recruit, next Explorer (morning review T3). |
| `constants.ts` | Lesson groups, discount window, `DISCOUNT_GATE_LESSON_ID`, `PLAYBOOK_UNLOCK_LESSON_ID` (l078), launch date, `PAYING_WHOP_PLAN_IDS` allowlist (v79; the visible $97 plan alone), `MONTHLY_97_PLAN_IDS` (2026-10-21: the course's two $97 monthly plans, the visible and the hidden one, which All students and the journey list and nothing else reads), `csmSprintWindowCutoffIso()` (v75.15 — `now - 30d` for CSM cron filters), `whopNoneFinishedNote()` and `isWhopNoneFinishedNote()` (the Whop backfill's "0 marked completed" note, shown on the admin student page as a note, 2026-10-16), etc. |
| `motion.ts` | GSAP / Framer easing constants |
| `useMediaQuery.ts` | SSR-safe phone-detection hook |
| `useFocusTrap.ts` | Modal a11y |
| `useJourneyPaceCounts.ts` | Admin Journey pace tile data. Since the cutover work it also holds what the admin pages share about activity: `loadCourseActivity(supabase, studentId?)` (the switch's moment and, only when it exists, each student's row of `student_last_counted_completion`; never throws, a failed read comes back as `{ ok: false }` and the pages show "—"), and the pill's words, tones and order. After the switch the hook counts the four activity labels instead of behind / on pace / ahead. |
| `map/` | Map geometry (path math, region bounds) |
| `sop-templates.ts` | SOP scaffolding: four Day 1/7/14/21 messages about regions, the 30 days and "R1 + R2". Nothing in `src/` imports it (git grep, 2026-10-14). |
| `catalog-tables.ts` | Which catalog the app reads. `CATALOG_TABLE_SUFFIX` becomes `REGIONS_TABLE` and `LESSONS_TABLE`; `CATALOG_SHAPE` becomes `CATALOG_IS_V2`. It throws when the module loads on any value outside the allowed ones, because a wrong table name would return an empty catalog with no error anywhere. |
| `curriculum-reset.ts` | The course switch as the code that judges a student's history sees it (cutover WI-1). No React, no Next, no environment. `CURRICULUM_RESET_KEY`; `getCurriculumResetAt(supabase)` reads `admin_config.curriculum_reset_at`, returns null with no row and **throws** on a read error or a value that is not a date and time with its zone, because a null on a failed read would judge everyone on the old 30-day clock again. It needs a service-role or team client: a student's client reads no row and gets null whatever the database holds. `courseAnchorIso` (the later of first payment, or `joined_at` with none, and the switch), `daysOnCourse` (`sprintDayNumber`'s rounding, held equal by the test), `activityLabel`, `resetDateUtc` and `clampStartToReset` (the snapshot floor's date), `cutoverProblems` (the lines `/admin/cutover` shows). Code that reads the active catalog branches on `CATALOG_IS_V2`, never on this. |
| `complete-lesson.ts` | `stampWatchCompletion()` stamps the watch half of a completion and is safe to call twice, and marks the row it wrote with `markCompletedAtReal()` (v112: `completed_at_real`, best-effort, after the row's own write; the webhook calls it too, on the lesson its delivery finished, before the badges are judged). `afterCompletionWrite()` runs what follows a completion, in order: streak, CSM reactivation, achievements, open-task re-evaluation, each best-effort. `POST /api/student/lesson-watched` calls both, and the Whop webhook calls `afterCompletionWrite` on the delivery that finished a lesson (since 2026-10-16); `toggle-lesson` still carries its own copy of the same four calls. |
| `world/access.ts` | Who may see `/world`, and where a student lands. `STUDENT_HOME` is `resolveHome(NEXT_PUBLIC_STUDENT_HOME)`: default `/dashboard`, a trailing slash dropped (`/world/` is `/world`). `/`, `/auth/complete`, the journal's redirect and `WorldAccessGate` all send to it, and `/dashboard` forwards to it when `HOME_IS_DASHBOARD` is false. `WORLD_IS_LIVE` is true when `NEXT_PUBLIC_WORLD_LIVE` is `true` or the home is `/world` (cutover call C14: with the home moved and the live flag forgotten, the gate would send `/world` to `/world` and render nothing). `canSeeWorld(studentId)` is true when the world is live or the id is in `NEXT_PUBLIC_WORLD_PREVIEW_IDS`; an unset list admits nobody. Also `WORLD_LOCK_MODE` (`"open"`). It is a convenience gate in the browser; video addresses and completions are guarded on the server. `client-tests/access.test.mjs` runs all 40 home and live settings: no loop. |
| `world/discount.ts` | Pure. The early-finish discount on the new course: `discountState()` (not eligible, expired, locked with the lessons and seconds left, ready, or the latest request's status), `requiredLessons()` and `gateLessonId()`, `DISCOUNT_PERCENT` (30), `DISCOUNT_LAUNCH_DATE` (9 October 2026, 00:00 in Croatia), `DISCOUNT_ELIGIBLE_FROM` (1 October 2026, 00:00 in Croatia; 9 September until Lovro moved it on 2026-10-19), `DISCOUNT_SHARED_DEADLINE` (the end of 23 October 2026 in Croatia), `discountWindow()` (closed, or the end and which window), `requestCounts()` (which requests count, read by `discountState` and Discount Earned), and since admin rebuild 2's render review fix round `discountWindowOpen()` (the window open and its deadline not past at a moment, the end's own millisecond inside, as `discountState` counts it) and `earliestOpenFirstPayment()` (the first payment a read of the open windows starts at), which the coupon cron reads. Shared by the map and the routes, so they cannot disagree about who is ready. The rule is under API Routes, Discounts. |
| `world/celebrations.ts` | Pure. When the map shows the old dashboard's two celebrations: `streakToCelebrate` (a streak other than the one last marked in this browser: above it, or below it, a new streak after a break, since 2026-10-17; the dashboard still waits until a new streak passes the old number), `approvalToCelebrate` (the request the map passes, not yet celebrated here), `approvalOnMap` (which application the map's 30% moment is for, since 2026-10-20: approved, or applied and within `RENEWAL_AHEAD_DAYS`, 5, of the application, when its line is "Your 30% is on your next payment."; never one made on the old dashboard before the launch), `renewalStillAhead` (that 5-day limit, which the checkpoint panel's applied line reads too; client-tests/discount-next-renewal.test.mjs works it out against the offer's dates), and the dashboard's two browser keys, so the dedupe is shared with `/dashboard`. |
| `world/discount-server.ts` | The server half: `loadDiscountReads` (the five reads, the catalog through `LESSONS_TABLE`, never throwing), `factsFromReads`, `decideDiscountRequest` and `approvalVerdict` (every video done by the student's deadline, `discountEndsAt`; T-080). Since the owner's review (2026-10-21) `membershipUncheckedRefusal` and `MEMBERSHIP_UNCHECKED` ("We couldn't check your membership just now. Try again in a minute.", a 503 with state `read-failed`): both request routes' answer when the coupon check could not run, with nothing written. `explainOldCourseRequest` (T-080) turns the approval's refusal of a request made before the switch over its videos into "This request was made on the old course, before the switch. Judge it by hand; Generate anyway skips the check.", with the new rule's count after it when videos are missing; a refusal over the first payment (before 1 October, or none on file) keeps its own words (2026-10-17, the refusal carries its `reason`). Everything fails closed: a read that errors, or comes back empty where a row must exist, means no request and no approval. `secondPendingRequest` (2026-10-16) turns v106's refusal of a second pending request into the answer for a request in review (`ALREADY_APPLIED`), on either course. `SAVE_FAILED` (2026-10-17) is both routes' answer to any other failed write, logged with the real error. Where the rule would approve, `approvalVerdict` refuses a request the app's Apply could not have made (`madeOutsideApply`, 2026-10-17, reasons `late-request` and `another-request`, which `explainOldCourseRequest` leaves in their own words): one made more than `REQUEST_GRACE_MS` (5 minutes, the longest a route's own insert can lag its check) after the student's deadline, or one beside another of the student's requests that counts (`requestCounts`) and was rejected, approved or applied. The approve route passes the request's id so the request itself is never "another". It also passes the switch's date (`curriculum_reset_at`, 2026-10-17): a request made before the switch is judged by the videos loaded by then, so a request from the old dashboard (a first payment from 1 October) is approved once all 59 are done by 23 October, and a September joiner's is refused over the first payment, and refused with the count when they aren't. |
| `world/tella.ts` | The small facts about Tella that both sides share, with no imports. `TELLA_ORIGIN` (`https://www.tella.tv`, the only origin the player listens to and posts to), `WATCH_SPEED_CAP` (2.5, the same number as `v_speed_cap` in the SQL function), `isTellaVideoId()` (the pattern of the table's check constraint) and `tellaEmbedUrl(id)`, which builds `https://www.tella.tv/video/{id}/embed?title=0&b=0&wt=0&a=0&o=1` and throws on a malformed id without repeating it. The five switches hide the creator's name and Tella's own links; the reactions row stays. |
| `world/tella-lock.ts` | Pure. `judgeLock(facts, expectedDomains, catalogDurationSeconds, catalogLesson)` decides whether a video is still locked and says why in plain sentences. `missing` when Tella has no such video. `open` when access is anything but "Embed only", when there is no domain list, when a site on the list is not an expected one (`localhost` included), or when downloads are on. `locked` otherwise. Four findings add a sentence and leave the status alone. Two are about the video: an expected site missing from the list, and a length more than 2 s away from the catalog's. Two are about the catalog, added on 2026-10-12 because either makes a lesson impossible to finish: a `watch` lesson with no length ("The catalog has no length for this lesson, so it can never be counted.") and a row whose id no `watch` lesson has ("No watch lesson has this id."). The catalog rules run whatever Tella answered, a 404 included. The fourth argument says what the catalog knows about the lesson: `"watch"` (the default), `"none"`, or `"unread"` when a catalog table could not be read, and then nothing is said about the catalog. `watchLessonSeconds(tables)` builds the length of every `watch` lesson by id from the catalog rows it is handed; a later table wins an id two tables share, so the caller passes the live table last. |
| `world/tella-api.ts` | Server only. `fetchTellaVideoFacts(videoId, apiKey)` makes the one read the lock check needs, `GET https://api.tella.com/v1/videos/{id}`. One request, reading the answer included, is given up after 10 s. It returns null on a 404, throws on any other answer that is not a 200, and throws on a 200 that has no settings or no download switches, so an answer nobody could read never comes out as "locked". A missing access level or domain list is handed on, and `judgeLock` reports it as `open`. A timeout, a failure to reach Tella and an answer that is not JSON each throw a sentence written in this file; an error from the network layer is never passed on in its own words. Nothing it throws names the video or the key. The key can read every video in the workspace and change the ones uploaded from its own login (measured 2026-10-13: a change to another member's video answers 404). Its only caller in the app is the lock check. |
| `world/tella-player.ts` | Tella's player protocol over `postMessage`, written out with no library. `parseTellaMessage()` is pure and reads the three messages the player sends (`ready`, `playbackState`, `timeUpdate`); a duration of 0 or less counts as no duration, because Tella sends 0 with "stopped". `attachTellaPlayer(iframe, events)` listens on `window`, accepts a message only from that iframe's own window and only from `TELLA_ORIGIN`, and posts the three commands (`play`, `pause`, `seek`) to that origin. A seek asked for before `ready` is sent when `ready` arrives. It replaced `bunny-player.ts`. |
| `world/lesson-transport.ts` | The three calls the lesson player makes, behind one interface (`LessonTransport`): `getEmbed`, `heartbeat` and `claim`. `realLessonTransport` is the one `/world` uses: `POST /api/student/lesson-video` and `POST /api/student/lesson-watched` with the session token, and the real heartbeat call. Neither request throws; a failure comes back as an answer. The interface exists so the development harness can stand in for the server. |
| `world/embed-cache.ts` | Pure. `withEmbedCache(transport)` puts a cache in front of any `LessonTransport` and adds `prefetch(lessonId)`, so a lesson's video address can be asked for before the click. One request per lesson at a time (a second ask gets the same promise); a `ready` answer is kept, 40 lessons at most, the oldest dropped; any other answer, and a request that threw, is not kept; at most 3 prefetches on their way, one beyond that skipped, never queued; `heartbeat` and `claim` pass straight through. A kept address never outlives the right to it: `setAccess(studentId, active)` empties the whole cache, requests on their way included, when the student changes or signs out and when the membership is not active (then nothing is kept or prefetched), and the cache also empties itself when its oldest address is more than 30 minutes old. It starts with no student and keeps nothing until told. `client-tests/embed-cache.test.mjs` proves each rule. |
| `world/useLessonTransport.ts` | The page's one cached transport, shared by the map's host (`WorldMap.tsx`, which prefetches when a place opens, when the card shows the next lesson, and when the pointer or the keyboard reaches a panel row, for lessons with a video) and the lesson page (`LessonScreen.tsx`, whose player reads it, and which prefetches the next lesson of the place once its own video says "ready"). `/world` gets `realLessonTransport` behind the cache; the development harness provides its stand-in server behind the cache through `LessonTransportContext`. Every caller tells the cache who is signed in and whether `membership_status` is `"active"`, read from AuthContext's `student` (the dev harness's pretend student stands in through `LessonAccessContext`), in a layout effect, before anything asks. The host also hands each lesson's route to `router.prefetch` on the same triggers, once per lesson per page; Next skips that in development. Nothing is prefetched while the membership is not active. |
| `world/catalog.ts` | The boundary between the world and the curriculum. `buildWorldCatalog()` turns lessons, regions, the completed ids and the watch rows into a `WorldCatalog`: areas sorted by `order_num`, lessons per area sorted by `sort_order`, progress per area, `hasVideo`, `lessonById`, the gate lesson. It reads only the fields both catalog shapes carry, never `day`. Since 2026-10-12 `hasVideo(id)` reads the `has_video` boolean the data route attaches to each lesson. The catalog holds no video id, and `videoIdFor` is gone. |
| `world/map-model.ts` | Pure. `buildMapModel()` turns the catalog and the completed ids into what the map shows: per area the lessons that count and the "feature" rows that do not, the student's place and next lesson (the first unfinished lesson the student can finish in the app: a `watch` lesson with a video, or an action item; a lesson with no video never holds a student and still counts in the totals, 2026-10-16; an action item with a video holds the student only until its video is watched, in the app or on Whop (`watchedLessonIds`, `isPassed()`), its hand-in still open and the lesson not done, 2026-10-19), the totals. It answers `empty` or `shape` for a catalog the eight-place map cannot draw (`MAP_PLACES` is 8). A lesson's `hasVideo` is true for a `watch` lesson whose `has_video` is true. |
| `world/scene.ts` | The first prototype map's three.js scene. Used only by `src/components/world/WorldCanvas.tsx` and the development page `/dev/world`; mounted by nothing a student can reach. |
| `world/useWorldCatalog.ts` | The hook form of `catalog.ts`: reads `StudentContext` and returns the `WorldCatalog` plus `loading` and `loadError`. |
| `world/watch-heartbeat.ts` | `createWatchHeartbeat()` turns the player's position reports (Tella's player sends one every 250 ms while it plays) into one `record_lesson_heartbeat` call per 15 seconds of playback, plus a forced one on pause, end, tab hidden and unmount. It counts played seconds by the clock, as an allowance that carries over. Every report adds 2.5 times the clock seconds since the last one to a budget that never holds more than 5.35 s. A forward step counts when it fits in the budget, and then uses it up. A step that does not fit is a skip: it counts for nothing and leaves the budget as it is. So every speed on Tella's menu counts, a busy page that handles two reports back to back loses nothing, and a skip, which arrives as one large step, counts for nothing. The budget starts at 0.35 s with the first report and after a seek. The first version of the rule judged each gap alone and credited 80.4% of a lesson watched at 1.5x with a 1 s stall every 5 s. It writes nothing until a position has been reported, so a lesson opened and left without playing does not overwrite the stored resume point with 0. A forced beat that fails, or that the 400 ms call gate holds back, is sent again after 2, 5 and 10 s and then given up. A beat carries at most 20 s of played time until one of the visit is accepted and 60 s after, what v100's function credits one, and only what an accepted answer shows was credited (its `watched_seconds` less the last accepted one's) leaves the bank, so a lesson watched through failed beats still counts once they get through (lessons-1, 2026-10-20). Any beat that fails moves the throttle clock, so a database call that keeps failing is tried every 15 s (it was measured at 120 calls a minute). `onResult(result, beat)` tells the caller which beat an answer belongs to: `beat.reason` is `throttle` or the reason handed to `flush`, and `beat.force` says whether it was forced. A forced beat with nothing new to say sends nothing and is answered with the last accepted answer, marked `repeated`. The options `rpc` and `now` let a test or the harness stand in for the database call and the clock; when `rpc` is given it creates no Supabase client. |
| `world/lesson-text.ts` | Pure. `parseLessonText(text)` reads a lesson's `description` into blocks and runs, in the format agreed with the loader: plain text, at most 8000 characters (cut past that), blocks apart by a blank line, a block of "- " lines is a bullet list, a block of "<number>. " lines is a numbered list with its numbers kept, any other block is a paragraph whose single line ends are line breaks; `**bold**` and `[label](https://...)`, where only an https address with a host becomes a link and any other is shown as its label. Windows line ends read as `\n`; an unclosed `**` or a broken link is shown as written. `client-tests/lesson-text.test.mjs` proves every rule. |
| `world/watch-rules.ts` | `judgeWatch()`: the server's rule for "watched". Position at 95% (`WATCH_POSITION_THRESHOLD`, the same number the SQL function holds) and played seconds at or above `WATCH_PLAYED_FLOOR` (an env var of the same name, default 0.8), both measured against the catalog's duration. |
| `world/action-items.ts` | Pure, no imports. An action item's rules, one set for every place that touches them: the Discord link (`checkDiscordLink`, the old route's pattern and words, the database's v28 CHECK), which halves the complete button writes (`actionWrite`), the lesson page block's state (`actionItemView`) and `PASTE_LINK_FIRST`. Since 2026-10-22 (branch `night/action-done`) also the one list of the action items finished with Done alone, `DONE_ONLY_ACTION_ITEMS` (`a5l08`, `a5l12` and `a5l22` of Static Ads and `a6l03`, `a6l10`, `a6l17`, `a6l19`, the four of AI Ads + Content) and `isDoneOnly`, read by the lesson page (`LessonScreen`, `ActionItemBlock`), `mark-action-shipped`, the journey's drawer (`student-detail.ts`), the admin dev page's made-up students and the three Whop writers (the webhook, `watch-sync.ts`, `whop-catchup.ts`), with `whopActionTime`, the time the backfill and the catch-up give such an action item's action half (Whop's own time for the lesson, never the pull's, so Triple Threat never counts a pull's rows on the pull's day; the webhook writes it at the event's moment, its watch half's). `client-tests/action-items.test.mjs` and `client-tests/done-only.test.mjs`. |
| `world-v6/` | The v6 map's 3D scene, 30 files. `scene.ts` is the scene itself: the camera on its rail, the click-in "park" view, the frame loop, and the calls the interface makes (`setWorldProgress`, `setProgress`, `setLock`, `setPaused`, `park`, `celebrate`). `layout.ts` is pure data: where the eight places are, their landmark words, the camera's route and the scroll budget of every stretch. `progress.ts` holds `WorldProgress`, the one shape the scene needs about a student (lessons per area, lessons done per area, the current area, the next lesson). `poster.ts` is poster mode: still renders of the opening and the eight stops for a machine that cannot draw the 3D, and since 2026-10-21 (branch `night/map-night`) the night and the morning twins of the opening and the first six places (`NIGHT_POSTER_IDS`, `MORNING_POSTER_IDS`, `posterSrc(id, tod)` with `tod` "day", "morning" or "night"). `clock.ts` is the student's clock (2026-10-20 night, branch `night/map-night`): the night factor from the local hour (`nightAt`), which page follows it (`clockSetting`: `/world` does, every other page is pinned to day unless its address says `?tod=day`, `night` or `clock`, or `?hour=HH` / `HH.MM`) and the watcher that reads it (`watchClock`); since 2026-10-21 also the morning (`MORNING_HOURS`, `morningAt`: 1 from 05:00 under the night, full to 09:00, gone by 10:00), the two together as a `ClockLook` (`lookAt`, `lookFor`, and `watchClock` hands one; `?tod=morning` pins it), which posters show (`posterTod`, by the lines in `POSTER_FROM`), the head's script that picks them before the first paint (`CLOCK_BOOT`, built from `nightAtHours`, `morningAtHours`, `parseHour`, `hourOf` and `pickPosterTod` as their own source and the file's constants as JSON) and the writers of the `<html>` attribute it sets (`markPosterTod`, `writePosterTod`). `light.ts` lays its night layer (`NIGHT_ROWS`, `nightKeyframe`, `setTrackNight`) over each place's own light by that factor and publishes the night's weight as `state.night`, by which the water, the sand, the gulls and the smoke darken, and since the tune pass of 2026-10-21 also the pale paints and canvas (`NIGHT_PALE`), the ground's colour (`NIGHT_GROUND_GREY` in `surfaces.ts`), the lamps and the lantern glass (`NIGHT_LAMP_TINT`), the moon's disc (`MOON_LOOK`, smaller on the ground rows), the sea's moon path, the campfire's glow (`FIRE_GLOW` in `dress-shore.ts`) and the lake lamps' streaks in the water (`HALO_REFL` in `dress-lakeforest.ts`). Since 2026-10-21 it lays a morning layer the same way under the night (`MORNING_ROWS`, `MORNING_BASE`, `MORNING_LOOK`, `MORNING_LIGHT`, `morningKeyframe`, `morningLook`; `setTrackClock` lays both, and with the morning at 0 it is the night's arithmetic unchanged) and publishes its weight as `state.morning`, by which the lamp materials turn toward unlit glass (`MORNING_LAMP_TINT`), the Landing's halos (`dress-shore.ts`) and the lake's lamps (`dress-lakeforest.ts`) go out, the fog ramp lays the morning's mist (`LookKey.mist`, `fwMist`) and the grade the dew (`MORNING_DEW`, `fwDew`), each behind a test that skips it at 0; the scene hands both factors on with `setClock`. `quality.ts` holds the four quality tiers, picks one from the GPU's name and the canvas size, and proposes a step down when frames run slow. The scene's load probe (`confirmTier`, 0.2 to 0.3 s waiting on the GPU) runs behind the loading screen, except on a first visit of a GPU that `quality.ts` puts at tier 0 with every program compiled: there it runs once the live 3D is on screen, after 4 frames drawn with the camera still (4 s at the latest), so the map shows that much sooner (2026-10-20). If the camera is moving by then, or has left the opening (a scroll, a jump, a park), the probe is skipped and only the governor starts, as after a remembered tier 0, so it never stalls a glide or measures a view other than the opening; posters it brings after the reveal fade in over the drawing 3D (0.9 s), as the governor's do. The rest are the camera rail (`rail.ts`), the terrain (`terrain.ts`), the contract between the scene and its modules (`modules.ts`), performance plumbing (`perf.ts`) and the art modules that build the places, the light, the water, the forest, the sky and the progress lanterns. `src/lib/` also still holds `world-v2/` to `world-v5/` and `world-codex/`, the earlier versions, which only their own development pages use. |

### The world's components (`src/components/`)

| File | Owns |
|------|------|
| `world/WorldStage.tsx` | Mounted by the `/world` layout. Reads the route segments below it: the first names the open place, the second the open lesson. Provides that as `useWorldStage()` (`base`, `openAreaId`, `lessonId`, `href()`), and renders `WorldMap` and then the route's children. The address is the only source of truth for what is open. |
| `world/WorldMap.tsx` | The map's host. Joins the catalog, the student's finished lessons, the discount (`useWorldDiscount`) and the address into the one input `WorldV6` takes (`WorldSource`), turns the map's four callbacks into address changes, and hands `WorldV6` the corner (`WorldCorner`, with `PlaybookLink` in its slot). Beside the map it mounts the discount's questions (`WorldDiscountForm`) and the two celebrations (`WorldCelebrations`). Shows one of four plain cards when the catalog is not ready. It writes nothing. Since 2026-10-19 it also hands the map the student's first name for the welcome (`firstName`): the first word of AuthContext's `student.name`, the field the header's "Signed in as" reads; the dev harness's pretend student stands in through `StudentNameStandInContext`. |
| `world/WorldCorner.tsx` + `world/corner.module.css` | The header's corner pill, its achievements list and its toast (Student Surfaces, `/world`). `CornerLink` is a link already styled for the pill's `playbook` slot. |
| `world/PlaybookLink.tsx` | The Playbook on the map (cutover WI-8): a `CornerLink` to `/dashboard/playbook` labelled "Playbook" when `StudentContext.playbookUnlocked`, nothing otherwise (the corner's empty slot then takes no room). |
| `world/WorldDiscountForm.tsx` + `world/discount-form.module.css` | The discount application's questions on the map (2026-10-14), the old dashboard's form in the world's look: one question at a time in the checkpoint panel's slot (the panel hidden under it, a light scrim over the world), a full sheet on phones; numbers, choices as native radios, a box for text; Esc, Cancel or a click beside it close it with nothing sent; sent, it closes and the panel says in review; refused, it stays and says why. Its rules are `src/lib/discount-feedback.ts`, its state `useWorldDiscount().form`. |
| `world/WorldCelebrations.tsx` | The old dashboard's two moments on the map, with the dashboard's browser keys and triggers (`src/lib/world/celebrations.ts`) and its two test events: `DiscountApprovedCelebration`, and the streak's moment on the number in the corner's pill (`useStreakMoment`, since 2026-10-15 in place of the full-screen `StreakCelebration`). Since 2026-10-17 a streak shown broken (0) makes it forget the number marked in this browser, so a new streak gets its moment from its first day, and `useMapUp` holds every moment that times itself (the approved 30%'s 5 s, the streak's 600 ms, the corner's 6.5 s toast) until the map is built, its loading screen gone and the tab in front; the 30%'s moment also waits out a lesson page (`paused`, from `WorldMap`) and is recorded as it opens. It plays for an approved application, or since 2026-10-20 an applied one within 5 days of the application, whose line is "Your 30% is on your next payment." (`approvalOnMap`, which `WorldMap` asks on the discount's clock). `WorldMap` passes no approval for an application made on the old dashboard before the new course opened (`madeBeforeLaunch`), so it is not celebrated on the map. Nothing fires until the student's data has loaded; the development page provides `CelebrationStandInContext` under `?celebrate=1`. |
| `world/useWorldBadges.ts` | The corner's data: the achievement catalog, the student's unlocks and the share of students holding each (since v112 of every active member, `achievement_unlock_stats`), read from Supabase in the browser as the old dashboard's `AchievementsButton` reads them, again on the window event `et:achievements-changed`; an unlock that arrives while the page is open is queued for the toast. Also the sign-out. The development page provides `HudStandInContext` and then nothing is read. |
| `world/useWorldDiscount.ts` | The student's discount for the map: `discountState()` over what the app already holds (since admin rebuild 2, D5, `StudentContext.membershipDiscounted` too: a discount already on the student's Whop renewal turns the panel to "You can't apply for this discount because you already have a discount applied to your account."), worked out again every minute. Apply opens the application's questions (`form`, read by `WorldDiscountForm`: the active questions `StudentContext` loads, sent through `StudentContext.submitDiscountFeedback`, `POST /api/discounts/submit-feedback`). With no active question Apply posts `POST /api/discounts/request` with the session's token, as the old dashboard does, without going through `StudentContext.requestDiscount` (that one returns at once unless the old course's R1 + R2 are done). What went in shows as in review until `StudentContext` brings a request it did not have before. The development page provides `DiscountStandInContext` (questions and sending in memory). |
| `world/useMapModel.ts` | `useMapModel()` names the five states the world can be in (`loading`, `error`, `empty`, `shape`, `ready`) for the host and for the routes drawn over it. |
| `world/PlaceRoute.tsx` | What `/world/[areaId]` renders: nothing for a known area, a card for an unknown one. |
| `world/LessonScreen.tsx` | The lesson page (see Student Surfaces). It reflects the server's answer about completion and has no way to decide it. It takes an optional `transport` and hands it to the player; `/world` passes none. |
| `world/LessonPlayer.tsx` | The video player. It asks for the lesson's embed address, puts Tella's frame on the page, attaches `tella-player.ts` in the same commit that mounts the frame, resumes from `last_position_seconds` when that is past 10 s and the lesson is not past 95%, and feeds the heartbeat. Once a heartbeat comes back accepted with the 95% point reached, it asks `lesson-watched` to count the lesson, and it keeps asking on later heartbeats until the answer is yes: one request at a time, at most one every 10 s, and a request the wait holds back is made when the wait ends. A request that fails is made again by the same timer when the 10 s end, three times at most, and the count starts again on the next heartbeat past 95%. It also asks once on opening a lesson whose stored row is already past 95%. Three lines can show under the progress line. A refusal for too little played says how much was watched and how much is needed. A video that played to its end while the server's answer to that last heartbeat still says the 95% point is not reached says the lesson finished and did not register; that state means the catalog's length for the lesson is missing or too long, and only the team can fix it. A player that has said nothing 12 s after its frame was put on the page says the video did not load (the clock runs from the mount because Tella's `ready` was measured to arrive before the frame's own `load` event in 20 of 21 loads, and a frame that never loads must still get the line), and the frame stays on the page. A reopened lesson's progress line starts at its stored position. Once a video is on the page it stays there: `recorded` turning false under it removes nothing, and the address is not asked for again. Its three calls go through a `LessonTransport` (default `realLessonTransport`). The wording of the three lines is in `.impeccable.md`. |
| `world/LessonText.tsx` | Draws a lesson's text on the lesson page from the blocks `lesson-text.ts` read: paragraphs with line breaks, bullet lists, numbered lists that keep their numbers, bold, and https links that open in a new tab with `rel="noopener noreferrer"`. React elements only, never `dangerouslySetInnerHTML`. |
| `world/LessonRating.tsx` + `world/lesson-rating.module.css` | "How was this lesson?" under the lesson page's foot (admin rebuild 2, WI-7, D10): five stars as a radio group (the arrow keys pick; 40px boxes, 44px on a phone), then a comment (optional, at most 1000 characters, a counter from 100 left) with Save and Cancel; saved, it shows "You rated it 4 of 5.", the comment and Edit. Nothing is sent until Save; it waits for `StudentContext.rateLesson`, which waits for the route and returns its sentence on a refusal (the picked stars and the comment stay). `LessonScreen` shows it only where `ratingRefusal` (`src/lib/world/lesson-rating.ts`) says yes: a video lesson, not the Ad Bounty's, watched and done as the map counts it. A refresh within 3 s of a save keeps the saved rating (the v74 guard's window). `/dev/world-app?rating=saved|refuse|offline|slow` shows its states (`fixtureRatings.ts`). Since the review's fix round, while its form is open (stars picked, or editing) it tells `LessonScreen` (`onFormOpen`), which draws "Next lesson" outlined (`data-quiet` in `world-ui.module.css`), so Save is the one filled button there. |
| `world/AreaScreen.tsx` | Exports `Panel`, the full-screen layer with one card that the lesson page and the two "not here" messages are drawn in. |
| `world/WorldAccessGate.tsx` | Sends anyone `canSeeWorld()` refuses to `STUDENT_HOME`, and renders nothing until it knows. |
| `world-v6/WorldPreload.tsx` | Mounted by the `/world` layout outside `StudentGuard` (only when the world is open to everyone) and by `/dev/world-app`. Starts the map's code downloading at once: `import("@/lib/world-v6/scene")`, then `preloadModules()`, which asks for the 17 modules unless the scene will show the posters (`?poster=on`, a stored poster verdict, a software renderer, no WebGL). Under 760 px wide it asks for nothing. WorldV6's own import then gets the same module (2026-10-20). |
| `world/WorldCanvas.tsx` | The first prototype map (loads `public/world/world.glb`). Only the development page `/dev/world` mounts it. |
| `world/AreaLessonList.tsx` | The lesson rows of the earlier area screen. Only the development page `/dev/area` uses it. |
| `world-v6/WorldV6.tsx` | The v6 map and everything drawn over it: the header, the card beside the student's place, the chip, the place panel, the timeline, the done card, the phone list view and poster mode. `WorldV6({ source })`: with a `source` it shows a real student and reports clicks to its host; with none it is the development page on fixture data. With a source the map opens on the welcome (2026-10-19, Lovro's words): "Welcome, {first name}" ("Welcome" with no name), "This is your map through the course." and Continue, which makes the arrival's trip to the student's place; the map no longer flies there by itself 900 ms after it is ready (the dev page still does). The welcome fades out over the first 40% of the scroll to the first place and comes back at the top; the scroll cue above the timeline ("Scroll" and a chevron that bobs six times) fades as the scroll starts. On phones the two lines head the list, with no button and no cue. |
| `world-v6/source.ts` | `WorldSource`, the map's one input, and `sourceData()`, which builds its data half from a `MapModel`. |
| `world-v6/content.ts` | `WorldContent`: the names, counts, titles and minutes the map's parts read, from the fixture or from the source, handed down through a React context. |
| `world-v6/study.ts` | The fixture for `/dev/world-v6`, and the `StudyArea`, `Study` and `LockMode` types the source reuses. Place ids, landmark words and meshes come from `src/lib/world-v6/layout.ts`. |
| `world-v6/cardPlace.ts` | Where the card and the panel sit so they never cover the landmark, and the leader line that joins them to it. |
| `world-v6/labels.ts` | Which place markers show as a text label and which as a dot, laid out once per frame. |
| `world-v6/tuning.ts` + `world-v6/TuningPanel.tsx` | The development TUNE panel and its saved state. Rendered only when the map has no source. |
| `world-v6/bench.ts` | `?bench=1` on the development page: the map runs its own route and reports frame times. |
| `world-v6/world.module.css` | The map's styles, scoped to `.root`. |
| `world-v6/tokens.module.css` | The world's colour, type, panel and focus-ring tokens as one `.tokens` class. The map's root carries it beside `.root`, and so does the wrapper of every screen drawn over the map or in its place. The values stay here until they move to `src/app/globals.css`. |
| `world/world-ui.module.css` | The styles of the lesson page, the two "not here" cards and the four catalog cards. Every colour and font in it is a token from `tokens.module.css`. |

## State Management

| Context | Scope | What it provides |
|---------|-------|-----------------|
| `AuthContext` | Global | `user`, `session`, `student`, `teamMember`, `isStudent`, `isTeam`, `signOut()`, `setStudent()` |
| `StudentContext` | `/dashboard`, `/dashboard/playbook`, and on branch `world-engine` also `/world` and its two child routes (mounted by `src/app/world/layout.tsx`) | Lessons, completions, streaks, discount state (NULL `first_paid_at` blocks claim post-v75.26), sprint milestones, playbook welcome, first-client landed, action-shipped toggles, etc. For the world it also provides `watchProgress`, `patchWatchProgress`, `markWatched` (which refetches the student's data, so the streak moves when a video finishes), `catalogSuffix` and `loadError`. The first load and every refresh are one function, `refreshFromServer`, which applies the whole of `GET /api/student/data` (an empty catalog is never applied over a loaded one) and reads the 30% questions while it holds none. A first load that fails is asked again after 1 s and 3 s, then sets `loadError` (the map's "Your course didn't load."; the Playbook page then stays put instead of sending a graduate away), and any refresh answered after that loads everything and clears it (T-026, 2026-10-20). `playbookUnlocked` is the one Playbook verdict for every surface (WI-8). The area counts skip `counts_toward_progress = false` lessons and the title ladder scales to the course's areas. |
| ~~`AdminScopeContext`~~ | — | Removed in v75.51. Cohort is the only admin view; no toggle. |

## Integrations

| Integration | Used for | Env vars |
|-------------|----------|----------|
| Supabase | DB + auth + RLS | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Whop | OAuth, promo codes, watch sync, membership webhooks, first payments (`GET /api/v1/payments` with `WHOP_API_KEY`, which needs `payment:basic:read`; `src/lib/first-payment.ts`) | `WHOP_CLIENT_ID`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_PRODUCT_ID`. No code reads `WHOP_CLIENT_SECRET`, which this row used to list: the OAuth flow is PKCE and sends no secret. |
| Discord | Day-28 DM, churn DMs | `DISCORD_BOT_TOKEN` |
| Tella (branch `world-engine`) | Lesson video for `/world`, as an embed in an iframe. The browser gets one lesson's embed address per request from `POST /api/student/lesson-video`, which needs no Tella value. The server talks to Tella's API in one place, the lock check. | `TELLA_API_KEY`, `TELLA_EMBED_DOMAINS` (the lock check only; see the table below) |
| Vercel | Hosting + cron + analytics | `vercel.json` |

**The world's own settings** (branch `world-engine`, names only):

| Env var | Read by | What it sets |
|---------|---------|--------------|
| `CATALOG_TABLE_SUFFIX` | `src/lib/catalog-tables.ts` | Which catalog the app reads: empty for `lessons` and `regions`, `_next` for the staging pair. Server side. |
| `CATALOG_SHAPE` | `src/lib/catalog-tables.ts` | Empty, `v1` or `v2`: whether the catalog has the v2 shape. Server side. `v2` on Production from the switch evening, with the suffix empty: without it the discount's old rule would run on the new data (it then refuses, cutover WI-9) and `/admin/cutover` names it first. |
| `NEXT_PUBLIC_WORLD_PREVIEW_IDS` | `src/lib/world/access.ts` | The allowlist: student ids, comma separated. Unset admits nobody. Ignored once the world is live. |
| `NEXT_PUBLIC_WORLD_LIVE` | `src/lib/world/access.ts` | `true` opens `/world` to every student. A home of `/world` opens it too, whatever this says. |
| `NEXT_PUBLIC_STUDENT_HOME` | `src/lib/world/access.ts` | Where every student lands: `/`, `/auth/complete`, the journal's redirect and the world's gate send there, and `/dashboard` forwards there when it is anything else. Default `/dashboard`; `/world` from the switch evening. A trailing slash is dropped. |
| `WHOP_COURSE_ID` | `src/lib/whop.ts` (the backfill of a student's Whop lesson history, `course_lesson_interactions`), `GET /api/student/data` (masked, for the sync debug panel), `GET /api/admin/cutover-status` (set or not, and its last 4 characters), `POST /api/admin/whop-catchup` (refuses with 500 without it; its snapshot hides it in an old sync error) | The Whop course whose lessons the sync reads. On the switch evening it becomes the id of the new course on Whop (the PRD's ship order, step 7); the old value is written down first, for an undo. The webhook has no course filter: it matches any Whop lesson id against `lessons.whop_lesson_id`. Server side. |
| `WATCH_PLAYED_FLOOR` | `src/lib/world/watch-rules.ts` | The share of a lesson that must have been played for it to count as watched. Default 0.8. Server side. |
| `TELLA_API_KEY` | `src/app/api/cron/check-lesson-videos/route.ts`, which hands it to `src/lib/world/tella-api.ts` | Tella's API key. It can read every video in the workspace and change only the ones uploaded from its own login. Server only: the lock check uses it and nothing a student touches does. `world-tests/tella-lock-live.mjs` reads it from `.env.local`, and so does the Tella tool outside this repository (with `TELLA_API_KEYS_MORE`, comma separated, when that line is there). The PRD records it as set on Vercel for Preview only (2026-10-12); that was not checked for this document. |
| `TELLA_EMBED_DOMAINS` | `src/app/api/cron/check-lesson-videos/route.ts` | The hosts a real lesson may be embedded on, comma separated. The lock check judges every video's domain list against it and refuses to run without it. Server only, and used by nothing a student touches. `localhost` never goes in it. The PRD's ship order has it still to be added on Vercel. |
| `DEV_TELLA_VIDEO_ID`, `DEV_TELLA_VIDEO_ID_2`, `DEV_TELLA_VIDEO_SECONDS` | The development harness layout (`src/app/dev/world-app/layout.tsx`, a server component), at request time. Two scripts in `world-tests/`, `tella-lock-live.mjs` and `tella-watch.mjs`, read the first two from `.env.local` and print neither. | Development only. The ids of the two Tella test videos and their length in seconds (default 67), for the three video lessons of `/dev/world-app`. In `?catalog=course` the first one plays under every course lesson that has a video. They live in `.env.local`, which git ignores. They are never `NEXT_PUBLIC_`, so they are in no browser bundle. With none set the harness has no video. |
| `DEV_COURSE_TEXT_FILE` | The development harness layout (`src/app/dev/world-app/layout.tsx`, a server component), at request time. | Development only. The path of a private JSON file outside the repository, `{"lessons": {"<lesson id>": {"title": "...", "text": "..."}}}`. Under `?catalog=course` (without `?text=sample`) each text goes on the lesson whose id and title match `course_catalog.json`; every entry left out is logged on the server with its id and why, and the text itself is never logged. Unset: no lesson has a text. |

A `NEXT_PUBLIC_` value is built into the browser bundle, so changing
one takes a new build.

`BUNNY_STREAM_LIBRARY_ID` and `BUNNY_STREAM_TOKEN_KEY` are no longer
read by any code: the signer and its route were deleted on 2026-10-12.
Taking them off Vercel is handed forward in the tella-player PRD.

The tables above are not the full list. The code also reads
`ADBOUNTY_WEBHOOK_SECRET`, `CRON_SECRET`, `DISCORD_TEAM_WEBHOOK_URL`,
`DISCORD_TEST_DM_RECIPIENT`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_INTRO_VIDEO_URL`, `NEXT_PUBLIC_KARLO_INTRO_VIDEO_URL`,
`PKCE_COOKIE_SECRET`, `STUDENT_AUTH_SECRET`, `WHOP_BYPASS_EMAILS`,
`WHOP_BYPASS_USER_IDS`, `WHOP_COURSE_ID` and `WHOP_DISCOUNT_PLAN_IDS`
(from `grep -rhoE 'process\.env\.[A-Z_0-9]+' src/` on 2026-10-07), and
since 2026-10-17 `STUDENT_APP_CLOSED` and `STUDENT_APP_OPEN_FOR`, both
read only in `src/lib/student-app-gate.ts` (see "The closed doors
before the new course").

## Lesson videos on Tella: the rules

Five rules, each with its reason. The design, the measurements behind
them and the decisions are in
`../_admin/prds/tella-player/tella_player_prd.md`.

**1. A Tella video id is never written into a tracked file, a commit
message, a log line or an error message.** The repository is public,
and with Tella the id is the video's address: the embed address is
built from the id alone, with no key and no signature. A committed id
is a published video. Ids are pasted in the Supabase SQL editor (into
`lesson_videos`, or over the placeholders of the morning kit) or kept
in `.env.local`, which git ignores. The course's ids are in the filled
copy of the video load and in the Tella tool's other working files,
which that tool keeps in its own `private/` and `bulk_ops/` folders,
outside this repository. The code keeps to the rule:
`tellaEmbedUrl()` and `tella-api.ts` never repeat an id in an error,
the routes log lesson ids, the lessons payload carries `has_video`
with no id, and the two undo files, the stamp file and the video load
refuse with a row count or a lesson id. A fake sample such as
`vid_doesnotexist0000000000` is fine.

**2. `localhost` is never an allowed domain on a real lesson.** Any
page on any machine's `localhost` could then embed that lesson.
`judgeLock` reports it as `open` like any other site that should not be
on the list. The two test videos keep it so the development harness can
play them, and no other video may.

**3. How to rotate a leaked video.** Duplicate the video in Tella. Lock
the copy at once (access "Embed only", the allowed domains, downloads
off), because Tella creates a copy as public with no domain list.
Update the lesson's `lesson_videos` row to the copy's id, in the SQL
editor. Delete the original. Until the lock check next runs, the row's
`lock_status` still describes the old video. For a course lesson the
next run of the video load sets the row to whatever its list holds, so
the list has to hold the copy's id by then.

**4. Once a month, check by hand that Tella still enforces the lock.**
Make one request with no login to a lesson's embed address, with an
allowed site as the `Referer` header, and one with no `Referer`. The
first should get the player and the second "No access". If the second
gets the player, the lock is not being enforced. The reason for doing
it by hand: the lock check reads a video's settings, and it cannot see
whether Tella still acts on them. If the workspace dropped off Premium,
Tella could go on reporting "Embed only" while serving the video to
anyone. The address holds the video's id, so it goes into the terminal
and into no file (rule 1).

**5. What Tella's lock is.** It is two settings on the video: access
"Embed only" and a list of the sites allowed to embed it. It needs
both, because a domain list on a video whose access is "public" closes
nothing. Behind them is a check of the `Referer` header on Tella's
server, measured on 2026-10-12: a request whose `Referer` is a listed
site gets the player and a stream address, and a request with no
`Referer` or an unlisted one gets "No access". So the lock stops a
forwarded link, which arrives with no listed `Referer`, and it stops
other websites from embedding the lesson. It does not stop someone who
sends that header themselves. This was chosen knowingly: the PRD's
validation log records it as a weak lock accepted with Karlo's decision
to host on Tella (row 14, with rows 12 and 13 beside it). The private
table, the membership check on the address and the lock check are what
the build puts around it.

## The closed doors before the new course (T-078)

Lovro, 2026-10-16: until the release on Monday 19 October, students see
"We are updating to the new course. It will be released soon." instead
of the login and the app, and the team's admin keeps working. Built on
branch `coming-soon` (`bb9421d`, the commit Lovro pushes to `main`) and
merged into `world-engine` with T-079 and T-080 (`53cabf5`).

Two Vercel values, both read only on the server. There is no
`NEXT_PUBLIC_` twin, and each change takes a redeploy:

- `STUDENT_APP_CLOSED`: `true` (any case, spaces trimmed) closes the
  student app. Anything else, or nothing, leaves it open exactly as
  before.
- `STUDENT_APP_OPEN_FOR`: Whop user ids (`user_...`), comma-separated.
  These accounts go through every door, so a test account can walk the
  app. It is read only in `src/lib/student-app-gate.ts` and never
  reaches the browser.

The doors (each asks `src/lib/student-app-gate.ts` and nothing else):

| Door | While closed |
|------|--------------|
| `/login` | `src/app/login/layout.tsx` renders `ComingSoon` (`src/components/auth/ComingSoon.tsx`): the name (the white logo on `world-engine`, text on `main`), Lovro's two sentences, and "Keep watching the course on Whop in the meantime." No button, no link. |
| The tab and a link preview | `comingSoonMetadata` gives the title "Ecom University" and Lovro's sentence as the description, on `/login`, `/dashboard` (and `/dashboard/playbook`), `/dashboard-mockup` and `/journal/[studentId]`. While open it gives nothing, and the root layout's own title and description stand. `/` (a spinner that redirects) keeps the root's; `/world` names itself "Ecom University". |
| `GET /api/auth/whop/callback` | Right after Whop's user info, before the membership check and any write, `whopLoginMayProceed` sends anyone not listed (and not a team member's Whop account) to `/login?error=app_closed`, and logs `[whop-callback] student app closed, refused <Whop id>`. No student row, tokens, sync or session. |
| `GET /api/auth/me` + `StudentGuard` | A student the app is closed to gets `appClosed: true` (absent otherwise). `StudentGuard` renders `ComingSoon` and mounts nothing under it: `/dashboard`, `/dashboard/playbook`, `/dashboard-mockup`, and `/world` with its places, its lesson pages, the 3D stage and its phone list. No WebGL loads. |
| Every route under `/api/student`, plus `discounts/request` and `discounts/submit-feedback` | `refuseWhileClosed` runs right after the token check, before any read or write, and answers 503 `{ error: "We are updating to the new course. It will be released soon.", code: "student_app_closed" }`. Reads refuse too (`data`, `cohort-stats`, `lesson-video`). It is 503, not 403, because the map's player reads a 403 from `lesson-video` as "membership not active". |
| `/journal/[studentId]` | A student's own journal renders `ComingSoon`. The team reads journals as before. |

Outside the gate: `/admin`, `/admin/login` (team members sign in with
email and password, an account separate from any Whop login),
`/api/admin/*`, `/api/auth/team`, `/api/auth/whop/authorize`, the
crons, the Whop and Ad Bounty webhooks (lessons finished on Whop keep
arriving), the team's discount routes (`approve`, `reject`,
`mark-applied`) and `/api/client-event`. A `team_members` row that
points at a Whop account gets through the callback; no code makes one.

What it can't stop: the heartbeat is a browser-to-database call
(`record_lesson_heartbeat`). While closed, the player never mounts,
`lesson-video` refuses the video address and `lesson-watched` refuses
to make a completion. Only a hand-written call with a held session
could bank watch seconds, and those would count after the doors open
(T-048's exposure). The feedback form's function,
`submit_discount_with_feedback` (v29), is the other such call until
v107 is pasted on Monday: with a held session, one call makes a pending
discount request, past the closure and past the routes' checks of the
first payment, the deadline and the videos. v107 lets only the service
role call it, and `approve` refuses a request made after the student's
deadline or beside another counted one (`madeOutsideApply`).

Signing in as a test account while closed: in a private window, sign in
to whop.com as the test account, then open `/api/auth/whop/authorize`
directly, since the coming-soon page has no button. A test account with
no paid membership also needs its id in `WHOP_BYPASS_USER_IDS`, as
before. If the coming-soon page comes back, `?error=` in the address
bar says why. `app_closed` means the id Whop sent isn't in
`STUDENT_APP_OPEN_FOR` (Vercel's logs show which id, under
`[whop-callback]`). `no_membership` means it also needs
`WHOP_BYPASS_USER_IDS`.

Tests: `client-tests/student-app-gate.test.mjs` checks the rule open,
closed, listed and for the team, plus the tab metadata, and reads every
student route, every team surface and every page that can show the
coming-soon page. It runs on `main` too.
`client-tests/student-app-gate-routes.test.mjs` runs 8 real routes
unset, closed, with the student listed and with someone else listed
(`world-engine` only).

## The course switch (cutover)

The rebuilt course reaches every student on one evening: one SQL file
switches the data, four Vercel values and a redeploy switch the build.
Built on branch `world-engine` on 2026-10-14 from
`../_admin/prds/cutover/cutover_prd.md`; none of it has run on
production, and the plan waits for Lovro's read and `/ship`. The
plan's ship order (end of its section 12) is the evening's full list
with every check. This section says how the app behaves.

**The evening, in short.** Any day before: v101 as it stands now, then
v103 (additive: the Playbook column, the two area columns, the view
`student_last_counted_completion`, the snapshot floor; nothing a
student sees changes), the merge of `world-engine` into `main`, and
`cutover-preflight.sql`, read with Astrid and Karlo. On the evening, at
an even UTC hour at :25 (the crons run at :00 to :20 every two hours,
the snapshot at 00:30): the Vercel Production values
`NEXT_PUBLIC_STUDENT_HOME=/world`, `NEXT_PUBLIC_WORLD_LIVE=true`,
`CATALOG_SHAPE=v2`, `CATALOG_TABLE_SUFFIX` empty or absent and
`WHOP_COURSE_ID` set to the new course on Whop, which act only on the
next build; then v104 in the SQL editor; then a redeploy at once; then
`/admin/cutover`, a student login on `/world` and
`cutover-postcheck.sql`. Between v104 and the new build being Ready
the old build meets the new data: no cron runs in that window if the
time is kept, and the discount's old rule refuses (cutover WI-9).

**On the preview before the switch** (the ship order's steps 1 and 2:
the staging catalog read against production's database), a new-course
lesson is not in `lessons` yet, so every heartbeat on one fails
(`record_lesson_heartbeat` raises "is not a playable watch lesson"),
and after about 30 seconds of playing the lesson page says "Your
progress isn't being saved. Check your connection." That is expected
there: nothing can be saved until v104 has run. Saving an action
item's link and applying for the discount refuse too, in plain words.

**What v104 does**, in one transaction that refuses with a sentence
ending "Nothing was changed." whenever it does not find the state it
was written for (its header lists every guard): copies the old catalog
and every progress table into `archive_v1`; stamps the Playbook for
the old course's graduates and fills missing first logins; turns off
the templates whose trigger names a lesson, an area, `progress_ratio`,
`progress_label` or `region_pace`, dismisses open `nolessons.*`,
`noship.*` and `pace.*` tasks and those templates' tasks with a note,
and dismisses open `no_tasks_7d` and `no_lessons_3d` alerts
(`no_login_5d` stays); empties completions, notes, ratings, the quiz
tables and every student's badges, and deletes six badges (`r1_clear`
to `r4_clear`, `early_finisher`, `speedrun`); replaces `regions` and
`lessons` with a copy of the staging catalog; puts the six keys back
as RESTRICT; writes `curriculum_reset_at`. Discount requests, streaks,
celebrations, daily notes, DM logs, the Whop sync's rows and the
snapshot history are left as they are. Every student starts the new
course with nothing done; lessons watched on Whop's new course come
back at the student's next visit (the sync) and new ones at once (the
webhook). Run again, v104 changes nothing and says since when the
switch is in place.

**Two signals, never mixed.** Code that reads the active catalog (the
world, the data and video routes, the action-item and discount routes)
branches on `CATALOG_IS_V2`. Code that reads `lessons` and `regions`
by name or judges a student's history branches on
`admin_config.curriculum_reset_at`: no row means the old course is
live. The row is written in the same transaction as the wipe, so it
cannot be forgotten, and admin client pages can read it, where they
cannot read a server value (call C6).

**After the switch, part by part.** Before it, each part behaves as it
did; the CSM and the achievements were proved side by side with their
old code on old-course fixtures.

- **Course days.** A student's day counts from the later of their first
  payment and the switch (`courseAnchorIso`, `daysOnCourse`), so
  everyone already enrolled is on Day 1 on the evening.
- **The CSM queue.** Lessons are counted per area of `regions`.
  `nolessons.day3/7/14` run on course days, so none fires in the first
  two course days. `noship.r1.day7`, `noship.r2.day14` and
  `pace.day7/14/21` return nothing (call C5). In team templates
  `progress_ratio`, `progress_label` and `region_pace` never match,
  and "days since last lesson" counts from the course start when
  nothing is done since. `no_tasks_7d` and `no_login_5d` alerts no
  longer become tasks, and `no_lessons_3d` becomes `nolessons.dayN`
  only for a student with 0 lessons. As committed, `day_number` in a
  team template still counts from first payment (morning review Q1),
  after the switch it counts course days, like `nolessons.*` (morning
  review R3, commit `9ffdec0`), so such a template does not fire for
  every student in the pool on the evening.
  The pool itself is unchanged, the crons' 30-day window, so a student
  who paid more than 30 days before the switch gets no CSM task on the
  new course (Q3). `check-engagement` writes its three "Day N" texts in
  course days (Q2).
- **Achievements and titles.** Every badge is archived and can be
  earned again, except the six deleted. `unbroken`, `perfect_run` and
  `region_sweep` count the eight areas, and titles scale to 0, 2, 4, 6
  and 8 areas. Streaks are kept (call C2), so a student holding a 7 or
  14 day streak gets that badge back at their next lesson. v112
  (pasted on production 2026-10-21) ends that: Two Weeks Strong and Region Sweep
  are gone, Habit Builder counts only the streak's days from the switch's
  date, and the Habit Builder rows handed out from old history (before
  25 October) are taken away into `archive_v112`.
- **Snapshots.** Rows before the switch day are frozen by the floor
  (`daily_progress_snapshots` under Database), and the three callers
  never ask for them.
- **Admin pages.** Activity in place of pace, 140 as the denominator,
  area names from `regions` (Admin Surfaces).
- **Students.** They land on `/world`; `/dashboard` forwards. The
  Playbook needs cutover WI-8 merged first; it is built on
  `world-engine` (2026-10-14: the gate reads the stamp, `/world` links
  to it; Student Surfaces, `/dashboard/playbook`).
- **The Whop sync** stays. The webhook and the backfill match
  `lessons.whop_lesson_id`, which then holds the new course's ids, one
  lesson per id; `WHOP_COURSE_ID` must name the new course or the
  backfill matches nothing. An old-course webhook event finds no lesson
  and is ignored.
- **The discount.** The new rule (API Routes, Discounts). A request
  still pending at the switch cannot be judged by the old rule after
  it, so the team decides every pending request before v104 (ship
  order step 5b).

**Activity, in place of pace** (call C4). There is no 30-day plan to
be ahead of or behind, so the pill says how long ago the student last
finished a lesson that counts: no such lesson, "Not started"; under 3
whole days, "Moving"; 3 to 7, "Slipping"; over 7, "Stalled"
(`activityLabel`). The admin pages read the date from the view
`student_last_counted_completion`, the CSM from its own snapshot by the
same rule. A lesson that was only skipped is not activity (morning
review B2). After the switch the view only holds lessons finished
since.

**Rollback**, the evening or the days after: `2026_v104_undo.sql`
(Undo files, under Database), then in Vercel remove
`NEXT_PUBLIC_STUDENT_HOME`, `NEXT_PUBLIC_WORLD_LIVE` and
`CATALOG_SHAPE`, set `WHOP_COURSE_ID` back, redeploy, and
`/admin/cutover` says "before". Progress made on the new course in
between waits in `archive_v2`. The undo of v103 runs only after it.

**A week later** (cutover WI-12, its own build, on Lovro's word once a
week of numbers has moved and no undo is in view): the old course's
branches, screens and constants, the day-28 DM, the preview gate and
`CATALOG_SHAPE` are deleted. The Whop sync, every column,
`lessons_next` and `regions_next`, and `archive_v1` stay. `tasks.md`
holds it.

## Testing

No test runner is installed and nothing runs on a push. Each harness
below is a script someone starts by hand, from `30-day-sprint/` unless
the row says otherwise. Node 22 runs the TypeScript directly
(`--experimental-strip-types`).

| Harness | Command | Needs the dev server | What it covers |
|---------|---------|----------------------|----------------|
| Client tests | `npm run test:client` | No | 78 suites, run from the real source files in `client-tests/` (copied into `client-tests/_gen/` by `build.mjs`, or by the suite itself). On 2026-10-22, on `night/preview-2026-10-21c` with T-122's second to fifth fix rounds and `night/action-done` (the 7 Done-only action items) merged: 4825 checks in 78 suites, 0 failed; eslint, `npx tsc --noEmit` and `npm run build` clean; on a dev server on port 3490 with no `.env.local`, the admin pages proof `PASS 2046   FAIL 0   NOT COVERED 0`, the discount checkpoint proof `PASS 27  FAIL 1` (row 18, the dev videos), the course browser proof `PASS 21  FAIL 3  NOT COVERED 10` (rows 9, 14 and 25, which fail the same way on `1c9c9a0` without the dev videos), the corner 11, the celebrations 16, the night on the page 25 of 25, the night posters 52 of 52, the stop tests' morning rows 42 of 42 and night rows 30 of 30. On 2026-10-22, on `night/action-done` with three of Static Ads added to the Done-only list (`a5l08`, `a5l12` and `a5l22`, the owner's answer that day): 4500 checks in 78 suites, 0 failed (`done-only` 76 to 109, `whop-catchup` 133 to 143, every other suite at its count before), and each of 17 breaks of the change failed a suite while its one control failed none (`client-tests/README.md`, under `done-only.test.mjs`); eslint on the changed files, `npx tsc --noEmit` and `npm run build` clean; on a dev server on port 3510 with no `.env.local`, the course browser proof `PASS 21  FAIL 3  NOT COVERED 10` (rows 21, 22, 26, 27 and the new 28 passing; rows 9, 14 and 25 failing as on `1c9c9a0`) and the admin pages proof `PASS 2046   FAIL 0   NOT COVERED 0` as before it. Earlier that day, after the adversarial check's fix round (the Whop writers give the four their action half): 4457 checks in 78 suites, 0 failed (`done-only` 57 to 76, `whop-catchup` 117 to 133, every other suite at its count before), and each of 21 breaks of the three Whop writers and `whopActionTime` failed a suite; eslint on the changed files, `npx tsc --noEmit` and `npm run build` clean; on a dev server on port 3510 with no `.env.local`, the course browser proof `PASS 20  FAIL 3  NOT COVERED 10` as before it (rows 26 and 27 passing; rows 9, 14 and 25 failing as on `1c9c9a0`) and the admin pages proof `PASS 2046   FAIL 0   NOT COVERED 0` as before it. Earlier that day, on `night/action-done` (the four action items of AI Ads + Content finished with Done alone): 4422 checks in 78 suites, 0 failed (`done-only` 57 joining; every other suite at its count before); eslint on the changed files, `npx tsc --noEmit` and `npm run build` clean; `world-tests/phones-input-zoom.mjs` `PASS 10`; on a dev server on port 3510 with no `.env.local`, the admin pages proof `PASS 2046   FAIL 0   NOT COVERED 0` and the course browser proof `PASS 20  FAIL 3  NOT COVERED 10` (its row, below). On 2026-10-22, on `night/admin3` for T-122's fifth fix round, the last (the rule stamp, a student whose row cannot be read, the membership read's shapes and a payment naming no buyer, another product's membership on file, a discount with no code named, the price's first payment and the ended memberships read at once, the v2 shutdown): 4110 checks in 70 suites, 0 failed. Changed: `membership-discount` 634 (+98: the round's own section, 96 checks, one case per item of the round through `judgeStudentDiscount`, both request routes, the normal Approve and the cron, with the controls, a 97.00 checkout with no code and a no-code student with two canceled course memberships at 2.0 s an answer, both let in, the second in 6.5 s with its last read started at 4.5 s; and 2 in the fourth round's section on the world-engine preview's row, stamped by this rule and still naming welcome50, and naming no code with the preview's word, each the 503). Its earlier checks read the stored source as the rule's stamp (`r5-` and the step) where they read the step's word, and seed this rule's rows with the stamp; three changed their answer with the round: with no course product named nothing is read (the membership on file was, and its code answered), a membership read answering `{}` is no answer (it read as no code, a known limit), and a stored no coupon holding a step's word alone is no answer (it answered). `admin-discounts` 29, `admin-owner-review` 58, `discount-double-submit` 33 and `discount-september` 65 seed their stored no coupon with this rule's stamp, and `admin-review` 100 answers a membership read with the id asked for (its stand-in answered another) and names the course product for its stalled cron run. 78 of the round's 96 checks fail on `f7e6b27` in a scratch copy (`git archive` of it, this suite's file copied in), 18 pass there: the controls, the Approve answers both builds give, and two the commit before refuses only because it does not know this round's stamp. On 2026-10-22, on `night/admin3` for T-122's fourth fix round (the stored rows, the v2 list, the ended memberships, the first payment, the student's own code, a body that cannot be read, Approve with no answer, the reads): 4012 checks in 70 suites, 0 failed. Changed: `membership-discount` 536 (+80: the round's own section, 76 checks, through `judgeStudentDiscount`, both request routes and the cron: the world-engine preview's stored no coupon naming welcome50 with Whop down, the 503 (and with Whop at 2.1 s an answer, Whop's own refusal); the v2 list answering 410 or 404, a fall-through the cron counts in `user_list_unusable` (a code on the second membership seen on its listed 0.00 payment, not without it), and answering another shape, another user's row, 5 pages or rows naming no buyer, no answer; a 100% first month on a canceled membership with its 0.00 checkout listed, left out or naming no code, and a first-year 10% on an expired one, each a coupon; a later 10.00 manual charge and a 47.00 add-on after a 97.00 first payment, each let in; the $1 and $5 first weeks still refused and listed in `refused_by_price` with their price and `billing_reason`; another student's ECOM30-5A1B2C sharing 6 characters, a coupon; a membership read answering an array, a JSON string or no JSON, no answer and kept nowhere, and `{}` the known limit; the stored fallback by the promo id on the student's own request; Approve on no answer refused with code `rule`, Approve anyway going on, the page's confirm naming the sentence; a no-code student at 2.5 seconds an answer, 200 in 5250 ms with 3 reads; and 4 more in the earlier sections), with the earlier checks following the new rule where it changed their answer (the reads' order, no plan read for a membership naming no code, the list in another shape or holding another user's row now no answer, a 404 list the fall-through, an ended membership's code found on it, the student's own code by name only beside a request, the approval with no answer refused); `admin-discounts` 29, `admin-review` 100 and `admin-owner-review` 58 unchanged in number (`admin-discounts` seeds a stored no coupon this rule wrote, since a check with no answer refuses the normal Approve; the others follow the reads' order and the seventh refusal carrying code `rule`). Against `a89ff1c` in a scratch copy: 447 pass and 89 fail; 52 of the section's 76 fail, and the 24 that pass are cases the old code already answered as this round does (the second membership on a 100% code with the v2 list answering, the 410 list with the 0.00 payment listed, welcome50 refused live, at 2.1 and at 2.5 seconds an answer, the no-code controls let in, the 404 and 410 lists letting the request in, the Approve controls), the known limits kept (the $1 and $5 first weeks, `{}`, the name beside a request), the plan's and the name's unreadable bodies, the answer naming no Whop id, and the cron's Whop-down run and the run after it; the other 37 that fail are the earlier checks the round changed. Before it, on 2026-10-22, on `night/admin3` for T-122's third fix round (a code anywhere is a coupon, then the price): 3932 checks in 70 suites, 0 failed. Changed: `membership-discount` 456 (+91: the round's own section, 84 checks, every case of the re-check through `judgeStudentDiscount`, both request routes and the cron: a 100% first month, with the $0 row listed, left out, and the renewal naming the used code, and with the code on the payments alone; a first-year 10% whose payment's `promo_code_id` is null or absent; welcome50's 48.50 whose total or `paid_at` does not read, on the membership and on the payment alone; a EUR payment naming no code beside welcome50 on the membership; a second membership on a 100% code beside the full-price one on file, its $0 row listed or left out, and no longer granting access; another student's ECOM30-ABC123, a code named ECOM30 and one named Ecom30Friends, on the membership and on the payment alone; a code whose name cannot be read; each a coupon; the controls 97.00 with no code, 97.00 and a 12.34 plan change, this student's own ECOM30 code on the membership and on a payment, 116.40 exclusive, 97.00 inclusive and EUR 89.90 with and without a `usd_total`, each let in; the student's own code by its request's promo id, through `checkMembershipDiscount` too; the stored fallback with and without a source and without v113; the approve route's code; and 7 more in the earlier sections), with the earlier checks following the new rule where it changed their answer (a used code still named is a coupon, the user's list read every time, `fetchCoursePayments`, the price in another currency, the student's own 30% by name or promo id, a stored no coupon needing its source); `discount-double-submit` 33, `discount-september` 65 and `admin-owner-review` 58 unchanged in number, their seeded "no coupon" rows holding a `source` now. Against `4e77736` in a scratch copy, the new suite with only the payments read's old name standing in: 363 pass and 93 fail; 64 of the section's 84 fail, and the 20 that pass are the controls the old code already let in, a code whose name cannot be read on a 67.90 renewal (a coupon by the old rule's price), the $1 known limit, the stored coupons, the applied request's refusal and the answer naming no Whop id; the other 29 that fail are the earlier checks the round changed. Before it, on 2026-10-21, on `night/admin3` for T-122's second fix round (every real payment, a named code, the tax and the currency): 3841 checks in 70 suites, 0 failed. Changed: `membership-discount` 365 (+56: the round's own section, each case through `judgeStudentDiscount`, both request routes and the cron: welcome50 on file paid 48.50 renewing at 97.00, a first-year 10% on the $970 yearly paid 873.00 renewing at 970.00, evolve10 on an older membership beside a newer full-price one on file, a membership naming evolve10 with no renewal price and one whose plan Whop does not know, each beside a 97.00 payment naming no code, and one found through the Whop user, each a coupon; the controls 97.00, 116.40 with tax added on top, 97.00 with the tax inside, 97.00 holding a tax whose behaviour is null, `unspecified` or `unable_to_collect`, 116.40 with a null behaviour, EUR 89.90 with a `usd_total` of 97.00 and with none, and a full-price membership on file followed by its payments, each none and let in; two coupons in euros; a payments read hanging after a full-price membership the 503 within 8 s; the team's own 30% never a coupon, on its own, on the 30% page and on the map; and the earlier checks following the new rule where it changed their answer: `taxOnTopOf`, `readMembershipDiscount`'s `unpriced`, `fetchRealCoursePayments`, an 87.30 on evolve10 before a newest 97.00 now a coupon, the row naming the coupon payment's membership, the payments read after a membership with no discount, and a Whop user on every fixture student), `admin-review` 100 (its stand-in fetch answers the payments list). Against 73c9d83 in a scratch copy, with the section spliced into that commit's own suite: its 309 checks pass, and 37 of the section's 50 fail; the 13 that pass are controls and team cases the old code already let through (97.00, 116.40 exclusive and 97.00 inclusive in judge and routes, the 116.40 null routes, the full-price membership's routes, a euro coupon on a code, the team's used 30%, the page's two team rows and the map flag). Before it, on 2026-10-22, on `night/preview-2026-10-21c` with `night/map-night` merged (the morning on the student's clock with its haze and posters): 4365 checks in 77 suites, 0 failed (`morning-clock` 105 and `night-posters` 97 joining); eslint, `npx tsc --noEmit` and `npm run build` clean; on a dev server on port 3490 with no `.env.local`, the admin pages proof `PASS 2034   FAIL 0   NOT COVERED 0`, the discount checkpoint proof `PASS 27  FAIL 1` (row 18, the dev videos), the corner `PASS 11`, the celebrations `PASS 16`, the night on the page 25 of 25, the night posters 52 of 52, the stop tests' morning rows 42 of 42 and night rows 30 of 30. On 2026-10-21, on `night/preview-2026-10-21c` (production `35bf390` with `night/admin3` merged: the owner's review of the admin preview, T-122 and its first fix round): 4221 checks in 76 suites, 0 failed; `npx eslint` on the changed `.ts`, `.tsx` and `.mjs` files and `npx tsc --noEmit` clean, `npm run build` passes; on a dev server on port 3490 with no `.env.local`, the admin pages proof `PASS 2034   FAIL 0   NOT COVERED 0`, the discount checkpoint proof `PASS 27  FAIL 1` (row 18, which needs the dev videos, as on every branch), the corner proof `PASS 11  FAIL 0` and the celebrations proof `PASS 16  FAIL 0`. On 2026-10-21, on `night/admin3` for T-122's fix round (the code on the payment, every course membership): 3785 checks in 70 suites, 0 failed. Changed: `membership-discount` 309 (+54: `taxOnTopOf` and `paymentCoupon` on their own; the payment read's subtotal and tax in both shapes; a $970 yearly member on a 10% code (873.00), evolve10 with 20% tax added on top (104.76), a payment's id with a list that cannot be used and a payment naming a code, and evolve10 beside a newer free course membership with a payment's id or the free one on file, each a coupon through `judgeStudentDiscount`, both request routes and the cron; the controls 97.00, 116.40 with tax on top and a yearly 970.00 naming no code, a 97.00 with the tax inside the price, a used code that took nothing off and a full-price membership beside a free one, each none and let in; Whop down or hanging on the second of two memberships no answer, the 503 within the routes' 8 s). Against the code before the round the new checks fail where they should: the five coupon cases through the judge, both routes and the cron, and the stored figures. Before it, on 2026-10-21, on `night/admin3` for T-122 (every student a yes or a no): 3731 checks in 70 suites, 0 failed. Changed: `membership-discount` 255 (+85: a payment's id, no id and an id Whop does not know answered through the Whop user, the order of a user's memberships, a null renewal price and no plan judged by the latest real payment at 87.30 and 97.00, no course membership with and without a payment, Whop down at every step, the deployment unable to ask, the payment read's own rules, both request routes, the approve route, Check Whop again, the cron's `by_source` and `failed`, the write without v113's column, the data route and the 30% page's stored row for a student with no membership id), `admin-review` 100 (+2: an Applied row with no membership id is "not checked yet" and its stored row counts; the payment's-id check on a stand-in fetch), `thirty-view` 98 (`couponOf` with no membership id on file). Before it, on 2026-10-21, on `night/admin3` after the owner's review of the preview: 3644 checks in 70 suites, 0 failed. New: `admin-owner-review` 58 (every rule of that review: the Dashboard's lines gone and its taller charts read from the source, the Bounty Program's arrow by `bountyTrend` with `previous14` counted to the millisecond and `BountyArrow` rendered from `DashboardView.tsx`, Approve anyway's skips and confirms, code "rule" from the approve route and `override` past it, applying refused when the coupon check cannot run, and the survey's required questions on both request routes). Changed: `membership-discount` 170 (the request routes refusing when the check cannot run, `overrideCoupon`, the helper's log words), `admin-people` 78 (+10: All students from 1 October, the pills, the reads by id, the journey's cards), `admin-discounts` 29 (a csm's override refused), `discount-double-submit` 33 and `discount-september` 65 (their students carry a stored answer for their membership), `admin-review` 98, `admin-render-fixes` 76 and `admin-render-second` 53 (their patterns follow the new source). On 2026-10-21, on `night/ship-achievements` (production `5f1bfca` with the $97-only change from `night/admin2` and `night/achievements` merged, the branch pushed to production): 3999 checks in 75 suites, 0 failed, `achievements-v112` 86 of them. `npx eslint` on the 24 changed `.ts`, `.tsx` and `.mjs` files: 0 problems; `npx tsc --noEmit` and `npm run build` pass; on a dev server on port 3490 with no `.env.local`, the corner proof `PASS 11  FAIL 0`, the celebrations proof `PASS 16  FAIL 0` and the admin pages proof `PASS 1962   FAIL 0   NOT COVERED 0`. On 2026-10-21, on `night/achievements` (v112, the badges for the new course, from `efe2652`): 3649 checks in 70 suites, 0 failed. New: `achievements-v112` 86 (the eight rules, and none of the eight taken out awarded to a student who meets their old rules; Triple Threat's `finishedAt` and `mostFinishedInOneDay` alone and through the evaluator, and a database without `completed_at_real`; the writers through their entry points: lesson-watched and the webhook mark their rows, a visit's sync marks none, the catch-up marks the rows with Whop's own time and not one given the run's clock, a failed mark fails nothing; Habit Builder's `streakDaysSinceSwitch` alone and through the evaluator, the old rule with no switch, the streak only read; `countsInShare` and `sharePercent`, and v112's view naming the same three conditions; 17 breaks of those rules in the generated copies each failed it). Changed: `achievements-cutover` still 114 (its parity with the module at `410e011` now holds for the seven rules v112 left as they were; Triple Threat and the eight taken out are left out of it, and its streak rows carry `last_streak_date`). `npx eslint` on the 16 changed `.ts`, `.tsx` and `.mjs` files: 0 problems. On 2026-10-21, on `night/preview-2026-10-21` (`night/admin2` with `night/map-night` and then `night/login1-main` merged): 3906 checks in 74 suites, 0 failed, which is `night/admin2`'s 3556 with `night-clock` 134 and `night-posters` 58 from `night/map-night`, login-1's `whop-product-setting` 104, `whop-webhook-product` 34 and `whop-webhook-old-rows` 19, and `first-payment` at 147 where `night/admin2` read 146 (login-1 added a check). `whop-product-setting` reads the two product ids from `whop-products.ts` since the merge; with one of them mistyped there, its check of the copies fails (103 of 104). On 2026-10-21, on `night/admin2` after the $97 plans came back to All students and the journey (the owner's answer): 3563 checks in 69 suites, 0 failed. Changed: `admin-people` 68 (+7: `MONTHLY_97_PLAN_IDS` holds the two $97 plans and `PAYING_WHOP_PLAN_IDS` is left as it was; both readers on a hidden $97, a yearly, an ETfB and a no-plan student; the two readers at `35d44d2`, copied from git into `_gen/*.before-97.ts`, as the control that every plan used to be listed; the two pages agreeing on one database; the headers' words). Before it, on 2026-10-21 after the render review's second round: 3556 checks in 69 suites, 0 failed. New: `admin-render-second` 53 (every rule of that round, the parts it renders compiled into `_gen/rs-*.mjs`; client-tests/README.md lists them). Changed: `membership-discount` 158 (`POST /api/admin/thirty/check-coupon` through its own handler with the real team check, `saved` on the reader's answer, the cron reading every pending request), `admin-review` 98 and `admin-render-fixes` 76 (their 30% row patterns and their count of `ReadFailure` follow the new source, and the reason's words are the second round's). Before it, on 2026-10-21 after admin rebuild 2's render review fix round: 3477 checks in 68 suites, 0 failed. New: `admin-render-fixes` 76 (every rule of that round, the views it renders compiled into `_gen/rf-*.mjs`; client-tests/README.md lists them). Changed: `dashboard` 88 (Avg progress on the 14 days), `membership-discount` 132 (the cron's window on a moved clock), `admin-review` 98 (its 30% row, header, fold and removal checks on the new rules), `thirty-view` 98 (the coupon's `promoCodeId` and `ours`), `lesson-feedback` 40 (the students' username), `streak` 85 (the student page's number tile). Before it, on 2026-10-21 after the review's fix round: 3389 checks in 67 suites, 0 failed. New: `admin-review` 98 (each finding of the review: a failed read in plain words with the database's text behind Details, Avg progress on Insights from the switch with its change in points, gridline labels that are their own values, the rated lessons only, one map of the 30% statuses, the Survey from 1 October with its summary, the Approved rows' coupon read from Whop now, a Whop id that is not a membership's said on the row, a cron run Whop never answered a failure, the quick DMs in the draft's words, the button and Refresh words, the removed page and helpers). Changed: `dashboard` 86 (+5: Refresh against Sync Whop and rebuild, expired students in Month 2 alone, `tasks_reset_at` through the Tasks page's check), `templates-page` 73 (+2), `csm-cutover` 48 (+1: `is_canceling`'s one label), `thirty-view` 98 (-6: the checks of the reason helpers that went with no page using them). `npx eslint` on the 165 `.ts`, `.tsx` and `.mjs` files the branch changed since `d0ebe76`: 0 errors from the branch, and 2 that were there before it, on lines it did not touch, both `react-hooks/set-state-in-effect`: `src/components/map/LessonSheet.tsx:957` and `src/contexts/StudentContext.tsx:918` (also at `d0ebe76`, lines 956 and 880). A later run that shows those two is not a regression. On 2026-10-20, on `night/admin2` with the 5 lanes of admin rebuild 2 merged (`night/a2-dash`, `a2-thirty`, `a2-tasks`, `a2-feedback`, `a2-templates`, in that order): 3289 checks in 66 suites, 0 failed. New: `dashboard` 81, `membership-discount` 122, `admin-people` 61, `lesson-rating` 74, `lesson-feedback` 40, `templates-page` 71, `survey-page` 22, `team-page` 14, `insights-page` 14. Changed from `night/admin2` before the lanes: `admin-tasks` 32 (+11), `student-context` 60 (+11), `admin-routes` 73 (+4), `function-regions` 28 (+4), `thirty-view` 104 (+2), `csm-cutover` 47 (+1), `streak` 85 (-1), `admin-pages` 17 (-2). `csm-cutover` is the Tasks lane's copy: both the Tasks and the Templates lanes adapted it to the one renamed label, and the Tasks lane's checks cover the label and the sentence. On 2026-10-20, on `night/a2-tasks` (admin rebuild 2, lane WI-5 and WI-6, from `ca9b5ef`): 2830 checks in 58 suites, 0 failed: `admin-people` is new (61: the populations of All students and the journey on the stand-in database, every failed read carried to the page, the Whop sync's mark on each side of the switch, the area named by counting lessons only, the six columns, the Tasks tabs, tiers and closed lines, the insights' floor and its route, the renamed words), `admin-tasks` 32 (11 new: the reset's line in every list and count, Archived, a failed or unreadable `tasks_reset_at` a 500; 1 of them fails against the route before it), `admin-pages` 17 (the drawer and the ads tick read where they live now), `csm-cutover` 47 and `outreach-cutover` 46 (the two renamed words put back before the comparison with their bases), `streak` 85. On 2026-10-20, on `night/admin2` (admin rebuild 2, WI-1): 2760 checks in 57 suites, 0 failed: `support-list` went with Today, `admin-today-routes` is now `admin-routes` (69: the 30% route's checks and 35 for `PUT /api/admin/config`; against the route before its key limit, 12 of them fail), and `admin-frame` is new (65: the bar for each role, the home, the dark-page rule, the removals and the moved product ids; with Today put back first in the bar and `/admin` matched as a prefix, 9 fail). With the morning haze's posters (2026-10-22, same branch): 60 suites, 0 failed, 3187 checks, twice (`night-posters` 97, its morning minute moved with the line: the morning posters to the minute 09:28, and its second by second check round that crossing from 09:27; the 7 morning files 718 KB, the day and night files byte for byte as before). After the morning's tune pass (2026-10-21, same branch): 60 suites, 0 failed, 3187 checks (`night-posters` 97, its dawn minute moved with the line: the night posters to the minute 05:35, the morning's from 05:36). Before it, on 2026-10-21, on `night/map-night` with the morning: 60 suites, 0 failed, 3187 checks; `morning-clock` 105 (new: the morning's window and fades beside the night's at every minute of the day, 10:00 to 20:00 the day exactly; `?tod=morning` and `?hour=`; the watcher on both factors; by day on the clock every value of the light at 4,055 points the light before the night, bit for bit, with no morning and no mist in it; at every minute of the dusk and at full night every value the night as it stood at `eab2330` (from git), bit for bit, and 05:00 too; the morning at the opening and the first six places, and from Creative Strategy on the old light bit for bit; the dawn a crossfade of the morning and the night with no day in it; the 09:00 fade; the keys reused), `night-posters` 97 (the head's script now picks day, morning or night and agrees with `clock.ts` at every minute on 16 addresses and second by second round its three crossings; the morning files, their sizes and the manifest's morning block, the night block and the 7 night files byte for byte those at `eab2330`; the stylesheets' morning rules and their third 48 px still), `night-clock` 134 (the watcher hands a look now). On 2026-10-21, on `night/map-night` with the night posters: 59 suites, 0 failed, 3043 checks; `night-posters` 58 (new: the head's script, run as its own text with a stand-in Date, picks day at 12:00 and night at 20:30, 23:00 and 05:30, and agrees with `clock.ts` at every minute of the day on 11 addresses and second by second round each crossing; the night files, their sizes and the manifest's night block; the 9 day posters byte for byte the files at `f0fb483`; the stylesheets' night rules and their two 48 px stills), and `phone-view` 36 and `phone-view-laptops` 25 reading the landing poster's twin from the stylesheet (`.posterLanding`) where it was a `<source>`. On 2026-10-20, on `night/we-sync` with `POST /api/admin/first-paid-repair` pinned to `iad1` (the commit after the merge): 2851 checks in 57 suites, 0 failed, `function-regions` 36 (4 new, the pin's; with its key misspelled on purpose, 1 of them fails). Before it, on `night/we-sync` (production's `main` at `73b783e`, the first-paid fix and the 30%'s one-line words, merged into `world-engine` at `cf22c36`): 2847 checks in 57 suites, 0 failed, every suite at the larger of its two sides' counts (`discount` 277 and `first-payment` 146 and `first-paid-repair` 74 as on `main`, `discount-september` 65, `admin-discounts` 28 and `admin-pages` 19 as on `world-engine`, and the nine suites only `world-engine` has unchanged), against 2617 checks in 55 suites on `world-engine` at `cf22c36` and 2346 in 48 on `main` at `73b783e`, each run alone the same day. One expectation changed in the merge: `first-paid-repair` reads the students' filter as `whop_user_id not is null`, the way the admin rebuild's `.not()` in `stub-server.ts` logs it. On 2026-10-20, on `night/q3-drop-ads` (the ads step dropped from approving the 30%, the owner's decision): 2615 checks in 55 suites, 0 failed (`admin-discounts` 28, `discount-september` 65, `thirty-view` 102, `admin-today-routes` 117); run against the source before it, the new and changed checks fail (1, 1, 15 and 2 of them). On 2026-10-20, on `night/assembly` (production plus the night's bug fixes, the Whop catch-up, the map fixes, the speed work and the admin rebuild): 2608 checks in 55 suites, 0 failed. On 2026-10-20, on `night/thirty-copy` (the 30%'s words as one line): 2346 checks in 48 files, 0 failed, `discount` 277 (10 new: the panel's 3 lines, every refusal, the shared window reading as the own one, `DISCOUNT_WINDOW_DAYS` pinned to 14) and `discount-september` 64 (the same checks, its refusals in the new words). No client test reads `WorldV6.tsx` there (on `world-engine` `phone-view` and `discount-next-renewal` read it, for the phone's media query and the applied line, not the rule's line): which line the panel shows in which state is the checkpoint walk's (rows 3, 10, 19, 24, 25 and 27 of `v6-discount.mjs`). On 2026-10-20, in the first-paid fix's review fix round on `night/first-paid`: 2336 checks in 48 files, 0 failed, `first-payment` 146 (41 new: a total that does not read and a lost dispute, each counted apart; a page in another shape, the buyer as a bare `user_id` or the total under another name, failing one user's read, the walk, the sync's recovery and the backfill as `bad_page` instead of "no payment"; the walk in 4 lanes giving the same first payments and counts as 1 lane with Whop taking its dates inclusive or exclusive, payments at each split counted once, the 4 lanes together at most 4 requests a second, half the time or less at 1 s a page, a 429 pausing every lane, and stopping on a Whop that ignores or refuses the dates; the sync's recovery read given up at 280 s with its `sync_runs` row written; the backfill in id order, its cursor, no student started past 240 s and no read waited on past 280 s) and `first-paid-repair` 74 (15 new: first payments and stored dates exactly at 1 October and at the launch, an applied request beside a 30% its new date opens, the ids behind the counts that open the 30%, the snapshot's new value, the oldest payment kept and the time per page, `"lanes": 4` through the route, a page in another shape writing nothing); 32 breaks of the round's code each failed one of the two. Before that round, on `night/first-paid` from `de9a077` (the first-paid fix): 2280 checks in 48 files, 0 failed, `first-payment` 105 (new: the rule on made-up payments in both of Whop's shapes, both payment reads on a stand-in fetch, and the webhook, the login, the sync and the backfill route through their entry points; the production writers fail it, webhook 4, login 11, sync 9, backfill 5, and 17 breaks each failed it once) and `first-paid-repair` 59 (new: `POST /api/admin/first-paid-repair` through its own `POST` with the real team login; dry, snapshot, write, the guard, a second write changing 0, a walk that does not finish writing nothing, the 280 s write limit, what the moves do to the 30% and its requests, no personal data in any answer; 13 breaks each failed it once). Earlier the same day, on `night/catchup` from `70c934a` (T-089, the Whop catch-up): 1770 checks in 32 files, 0 failed, `whop-catchup` 102 (new: `POST /api/admin/whop-catchup` itself, with the real `whop.ts` read on a stand-in fetch and the real `admin-auth.ts` on the stand-in's auth; who may run it, the refusals, dry, write beside the backfill's own sync rows, the 429 waits, the filter stop, 25 unmatched, 5 failures in a row, the pace, the time budget and its cursor, the snapshot, no Whop id, email or course id in any answer or log line; 19 broken versions of the run were each caught) and `streak` 86 (2 new: the catch-up's tick, and its file in the list of callers). In its review fix round the same night: 1785 checks in 32 files, 0 failed, `whop-catchup` 117 (15 new: a login's row landing as the run's insert goes out, and a login's finish as its update goes out, each kept and claimed nowhere; a 429 at 230 s naming 30 s, which ends the call at once; the pace after a 500 and after 5 pages; a Whop read given up 285 s into the call and one answered at 284 s kept, with no timer left running; a streak that already counts today left alone, uncounted and unlisted, and an unreadable one not ticked. The suite's clock now fires timers in the order they fall due. The review had found 6 broken versions the suite let through; each now fails it, as do 8 breaks of the two rules the round added). On 2026-10-19, with the 30%'s first date moved to 1 October (the preview review's cutoff build, other builders' work in the tree): 1647 checks in 31 files, 0 failed (`discount` 266, `discount-september` 64, `discount-earned` 22, the rest as on 2026-10-17); with the date put back to 9 September in a scratch copy, 24, 6 and 2 of them fail. In its fix round (the shared and closed lines name their dates, the closed one with "Croatia time"): 1648, `discount` 267 (new: a first payment at 05:59 on 1 October in Manila, refused, the refusal saying whose 1 October it is). Then the action item rule (an action item with a video holds the student only until its video is watched): 1666, `map-model` 69 (18 new, on the real course: a3l17 watched, Whop progress up to a4l05, a setup action item, an open hand-in; 6 of them fail against the old `map-model.ts`). At `297e999` (the new login, the same evening) one check failed and stopped the chain before its last two files: `student-app-gate`'s "the login page knows that code" read `page.tsx`, which no longer holds the `?error=` map; it now reads `LoginError.tsx` and checks that `page.tsx` renders it, and the run is 1666 checks in 31 files, 0 failed. On 2026-10-17, on `world-engine` at `53cabf5` (the three release builds merged, T-078 to T-080) with the release integration on top (the 30% panel's words, the streak moment after a break, one plain sentence for a failed discount write, the approval's refusal of an old request keeping its first-payment words, the questions form's function called as the server and the approval's two refusals of a request no route could make, and in its second fix round a request from before the switch judged by the switch's videos, the approve route itself run (the ads check after the rule), the data route sending no promo code, and the Whop read refusing other students' rows): 1630 checks in 31 files, 0 failed (before that second fix round 1598, with `discount` 244, `whop-backfill` 37, `discount-september` 48): `watch-heartbeat` 91, `watch-rules` 16, `catalog` 22, `access` 35, `map-model` 51, `tella` 75, `tella-player` 62, `lesson-text` 62, `embed-cache` 56, `action-items` 77, `discount` 252, `curriculum-reset` 78, `achievements-cutover` 114, `csm-cutover` 46, `playbook` 28, `celebrations` 21, `discount-feedback` 11, `whop-backfill` 47, `whop-webhook` 18, `action-shipped-route` 17, `skip-lesson-route` 11, `csm-events` 20, `discount-earned` 21, `heartbeat-trouble` 16, `outreach-cutover` 46, `discount-queue` 25, `discount-double-submit` 33, `streak` 84, `student-app-gate` 84, `student-app-gate-routes` 49, `discount-september` 62. At `53cabf5` as committed: 1564 (`celebrations` 17, `discount` 230, `discount-double-submit` 28, `discount-september` 37). The four suites new that day: `streak` (T-079: every route that writes or shows the streak, each run through its own entry point, the login callback included with Next's `after()` as a stand-in; the stand-in runs the real `update-streak.ts`, and the webhook the real `complete-lesson.ts`), `student-app-gate` and `student-app-gate-routes` (T-078, the closed doors), and `discount-september` (T-080: a student who first paid on 2 October, a September joiner until 2026-10-19, through the real backfill, webhook, both request routes and the approval on a hand-set clock, v29 standing in; since 2026-10-19 also a September payment refused by both routes and by Approve). On the builders' own branches: T-079 on `rp-streak` (from `6706d48`, commits `e4ea88d` and `26955ee`), 1312 checks in 28 files, 0 failed; T-080 on `rp-discount` at `77452b7`, 1346 checks in 28 files, 0 failed (`discount` 230, `discount-september` 37, `discount-earned` 21). On `main` once `coming-soon` is pushed, `npm run test:client` runs `client-tests/student-app-gate.test.mjs`, main's only client test. On 2026-10-16, in the second Loom round's backend pass on `world-engine` past `14716be`: 1210 checks in 27 files, 0 failed: `watch-heartbeat` 91, `watch-rules` 16, `catalog` 22, `access` 35, `map-model` 34, `tella` 75, `tella-player` 62, `lesson-text` 62, `embed-cache` 56, `action-items` 77, `discount` 154, `curriculum-reset` 78, `achievements-cutover` 114, `csm-cutover` 46, `playbook` 28, `celebrations` 17, `discount-feedback` 11, `whop-backfill` 37, `whop-webhook` 18, `action-shipped-route` 16, `skip-lesson-route` 11, `csm-events` 20, `discount-earned` 15, `heartbeat-trouble` 16, `outreach-cutover` 46, `discount-queue` 25, `discount-double-submit` 28. At `14716be` (2026-10-16 morning): 1177 checks in 26 files. After the second Loom's map-ui pass (2026-10-16): 1227 checks in 27 files, 0 failed, `map-model` 51 (17 new: a lesson with no video never holds a student). Since `14716be` these suites run server code through its own entry point (a route's `POST`, or the library the route calls) on a stand-in database, `client-tests/_gen/stub-server.ts`, which is hand-written: `whop-backfill`, `whop-webhook`, `action-shipped-route`, `skip-lesson-route`, `csm-events`, `discount-earned` and `discount-double-submit` (the two routes that write a discount request: a double submit refused by v106, and since 2026-10-17 every other failed write answered with `SAVE_FAILED`, the real error in the log), and since 2026-10-17 `streak`, `student-app-gate-routes` and `discount-september`, ten in all; since 2026-10-20 also `whop-catchup`, eleven. None of them meets a real database or a real login. On 2026-10-14 night, on `world-engine` past `32fe4db` with the Playbook, the questions and the celebrations in the working tree: 978 checks, 0 failed: `watch-heartbeat` 91, `watch-rules` 16, `catalog` 22, `access` 35, `map-model` 34, `tella` 75, `tella-player` 62, `lesson-text` 62, `embed-cache` 56, `action-items` 77, `discount` 154, `curriculum-reset` 78, `achievements-cutover` 114, `csm-cutover` 46, `playbook` 28 (the old Playbook gate from git beside the new on 9 old-course fixtures, same verdicts; then the real new course: the stamp, the last counting lesson, 80% at day 31 and day 10, a lesson given `playbook_unlock`, nothing loaded yet), `celebrations` 17 (the browser keys read out of the dashboard page and equal, the streak and approval rules), `discount-feedback` 11 (the answer rules, and that both forms import them). At `3678190` (2026-10-14, run on a copy of that commit): 893 checks, 0 failed: `watch-heartbeat` 91, `watch-rules` 16, `catalog` 22, `access` 35, `map-model` 34, `tella` 75, `tella-player` 62, `lesson-text` 62, `embed-cache` 56, `action-items` 77, `discount` 133, `curriculum-reset` 75, `achievements-cutover` 114, `csm-cutover` 41. The two cutover suites take the module as it stood before the cutover from git (`git show <base>:<path>`, the base written in the test) and assert the old and the new give the same results on old-course fixtures with no switch: `csm-cutover` compares every trigger, every condition over every metric and every old snapshot field for 14 students over days 1 to 30 (700,140 comparisons, 0 differences), then the new course; `achievements-cutover` every rule and every title count for 12 students. Both need the repository's git history to run. On 2026-10-12, after decisions D14 to D19: 312 checks, 0 failed: `watch-heartbeat` 91, `watch-rules` 16, `catalog` 22, `access` 12, `map-model` 34, `tella` 75, `tella-player` 62. On 2026-10-14 the `lesson-text` suite was added (62 checks, every rule of a lesson's text format, `javascript:`, `data:` and `http:` refused, broken links and an unclosed `**` shown as written, the 8000-character cut, Windows line ends): 374 checks, 0 failed. The `tella` suite proves the id pattern, the exact embed address, that `WATCH_SPEED_CAP` and the SQL file's `v_speed_cap` are the same number, every rule of `judgeLock` with its two catalog sentences, and `watchLessonSeconds`. The `tella-player` suite proves the message parser, and who `attachTellaPlayer` listens to and posts to. The heartbeat suite proves that reports 250 ms apart count at 1x, 2x and 2.5x and that a skip does not, that reports handled back to back after a 1 s stall lose nothing, that the allowance never holds more than 5.35 s, that a forced beat that fails or is held back by the gate is sent again after 2, 5 and 10 s and then given up, that a failing database call is tried every 15 s, and that each answer comes with the beat it answers. The heartbeat suite proves nothing in a browser, nothing about what Tella's real player sends, and no route or database. On 2026-10-20 night, on `night/map-night` (the night on the student's clock): 2985 checks in 58 suites, 0 failed, `night-clock` 134 (new: the clock's hours, overrides and watcher, and by day every value of the light at 4,055 points along the route the same bit for bit as `light.ts` at world-engine d0ebe76, kept as `client-tests/fixtures/light-d0ebe76.ts`). After the night's tune pass (2026-10-21, `night/map-night`): 58 suites, 0 failed, `night-clock` 134 of 134 (the day still the same bit for bit). |
| Migration tests | `npm run test:migrations` (once before the first run: `npm install` in `supabase/migration-tests/`) | No | Migrations v92 to v101 and v103 to v110 on a local Postgres (PGlite) in `run.mjs`, v111 in `v111.test.mjs`, v112 in `v112.test.mjs` and v113 in `v113.test.mjs`, which the same command runs after it in that order (v112's with `--experimental-strip-types`), with the generator of v101, the undo files, the morning kit, the video load, the text load, the course check, the cutover's two checks, the backend audit's read and the Whop sync read. On 2026-10-22, on `night/preview-2026-10-21c` with T-122's fifth fix round and the Done-only action items merged: `PASS 702   FAIL 0`, then `PASS 22   FAIL 0`, then `PASS 65   FAIL 0`, then `PASS 34   FAIL 0`; `check-non-course-members.mjs`: `PASS 7   FAIL 0`. On 2026-10-22, on `night/admin3` for T-122's fifth fix round (v113 changed, pasted nowhere): `PASS 702   FAIL 0`, then `v111.test.mjs` `PASS 22   FAIL 0`, then `v113.test.mjs` `PASS 34   FAIL 0` (the rule stamp: this rule's three values and `source_checked_at` written, an earlier round's words refused and emptied from a database holding the earlier copy, the older builds' writes as PostgREST makes them, an earlier round's refused whole and one from before T-122 keeping the stamp with a new `checked_at`, the undo dropping both columns). On 2026-10-22, on `night/admin3` for T-122's fourth fix round (no migration in it): `PASS 702   FAIL 0`, then `v111.test.mjs` `PASS 22   FAIL 0`, then `v113.test.mjs` `PASS 23   FAIL 0`. On 2026-10-22, on `night/admin3` for T-122's third fix round (no migration in it): `PASS 702   FAIL 0`, then `v111.test.mjs` `PASS 22   FAIL 0`, then `v113.test.mjs` `PASS 23   FAIL 0`. On 2026-10-21, on `night/admin3` for T-122's second fix round (no migration in it): `PASS 702   FAIL 0`, then `v111.test.mjs` `PASS 22   FAIL 0`, then `v113.test.mjs` `PASS 23   FAIL 0`. On 2026-10-22, on `night/preview-2026-10-21c` with the morning merged: `PASS 702   FAIL 0`, then `PASS 22   FAIL 0`, then `PASS 65   FAIL 0`, then `PASS 23   FAIL 0`; `check-non-course-members.mjs`: `PASS 7   FAIL 0`. On 2026-10-21, on `night/preview-2026-10-21c`: `PASS 702   FAIL 0`, then `PASS 22   FAIL 0`, then `PASS 65   FAIL 0`, then `PASS 23   FAIL 0`; login-1's `node supabase/migration-tests/check-non-course-members.mjs`: `PASS 7   FAIL 0`. On 2026-10-21, on `night/admin3` for T-122's fix round (no migration in it): `PASS 702   FAIL 0`, then `v111.test.mjs` `PASS 22   FAIL 0`, then `v113.test.mjs` `PASS 23   FAIL 0`. On 2026-10-21, on `night/admin3` for T-122: `PASS 702   FAIL 0`, then `v111.test.mjs` `PASS 22   FAIL 0`, then `v113.test.mjs` `PASS 23   FAIL 0` (the source column: refused before v113, pasted twice, the three words and empty, who writes and reads it, the undo twice keeping every row, v113 again, and on a database without v111). On 2026-10-21, on `night/ship-achievements` (production `5f1bfca` with `night/achievements` merged): `PASS 702   FAIL 0`, then `PASS 22   FAIL 0`, then `PASS 65   FAIL 0`; login-1's `node supabase/migration-tests/check-non-course-members.mjs`: `PASS 7   FAIL 0`. On 2026-10-21, on `night/achievements`, with v112 and its undo in `v112.test.mjs` (the badge tables made by the real v53, v56, v76, v90 and v91, v93's view lifted, the switch's catalog change; made-up students on each edge of each rule: the first paste's table and its numbers, the eight and their sentences, Habit Builder's cut at 00:00 on the 25th, Triple Threat kept for exactly the holders `src/lib/achievement-rules.ts` says meet the rule, every lesson row judged as its time says, the share against `countsInShare` and `sharePercent`, the archive the owner's alone; a second paste changing nothing; the old code's awards after it taken by a later paste and the new code's kept; the undo putting the catalog, every badge row, the view and its comment back and keeping the flags; a second undo; v112 again; five refusals and a missing table, the undo's refusal; both files' lock and its timeout; each of 15 breaks of v112 and its undo fails it): `PASS 702   FAIL 0`, then `PASS 22   FAIL 0`, then `PASS 65   FAIL 0`. On 2026-10-21, on `night/preview-2026-10-21` (`night/admin2` with `night/map-night` and then `night/login1-main` merged): `PASS 702   FAIL 0`, then `v111.test.mjs`: `PASS 22   FAIL 0`; login-1's `node supabase/migration-tests/check-non-course-members.mjs`, which the command does not run: `PASS 7   FAIL 0`. On 2026-10-20, on `night/admin2` with the 5 lanes of admin rebuild 2 merged, with v110 and section 32 (admin rebuild 2, D10: before v110 a student's own session rates a lesson they never finished; after it their insert and upsert are refused and their update and delete touch no row, while they still read their own ratings, the team reads all and the service role writes; a second run, the undo putting v75's four policies back exactly, v110 again): `PASS 702   FAIL 0`, then `v111.test.mjs`: `PASS 22   FAIL 0`. On 2026-10-20, with v109 and section 31 (admin rebuild 2, D7, the tasks reset: its lock and timeout, the copy and the dismissal of the 5 open tasks with every other row, table and grant unmoved, a second run, then the crons and the team changing things and the undo leaving those and putting back the rest byte for byte, its second run, v109 again, and every refusal): `PASS 677   FAIL 0`. On 2026-10-20, with v108 and section 29 (the bug hunt's cron-3, on a database as on Supabase and on a bare one: a visitor and a student refused, the service role keeping EXECUTE, a second run changing nothing, the undo putting the ACL back byte for byte): `PASS 634   FAIL 0`. On 2026-10-19, with section 28 (`whop-sync-proof.sql` before and after v104, and the lookup both Whop paths run finding no new-course lesson before the switch and both after it): `PASS 606   FAIL 0`. On 2026-10-17, with v107 and section 27 (the release review's fix round): `PASS 583   FAIL 0`. Section 27 runs on section 26's database, with `auth.role()` as Supabase defines it: before v107 a student's own session writes a pending request through v29's function and the service role is refused; after it a student and a visitor get 42501 before the function runs, the service role writes the request and its answer, v29's duplicate check and inserts are kept word for word, a regrant to `authenticated` still meets the function's own refusal, a call from the SQL editor (no request token) is refused, a second run and v105 pasted again change nothing, it refuses with the function or `auth.role()` missing, and the undo puts v29's function back exactly (after it the service role is refused again, so it goes only with the old route). In the second fix round it also pins the three answers of T-090's check after the paste: the service role's call for a student id no row has gets 23503, with no service_role in its token the function refuses it (P0001), and as another role it gets 42501: `PASS 584   FAIL 0`. On 2026-10-17, on `world-engine` at `53cabf5` (the three release builds merged): `PASS 566   FAIL 0`. Since T-080, section 26 also runs the real v29 function for a student holding a request from before the launch (pending, approved and applied refused, rejected written), on its own copy with v21 applied first, since `base.sql` predates v21's `applied` status (production has v21). On 2026-10-16, in the second Loom round's backend pass past `14716be`: `PASS 565   FAIL 0`. Sections 25 (v105, its undo and `backend-readiness-read.sql`) and 26 (v106 and its undo) came with `14716be`, 514 before them (at `d7d1a73`); they test the student policies for real under `SET ROLE authenticated` and `service_role`, and show a second pending request refused with 23505 under the index's name. At `3678190` (run 2026-10-14): `PASS 492   FAIL 0`, 312 before the cutover's sections 23 and 24. Section 23 (v103 and its undo): the four objects, the progress views and the snapshot numbers unchanged, a second run changes nothing, the view's value (no row for a skip only or a half-done action item), the floor inert without the key and refusing a rebuild, update, delete or insert before the switch day with it, the undo. Section 24 (v104 and its undo): one copy of the database per broken starting point, each refused with nothing changed; the first run's archive, stamps, CSM changes, wipe, copy, RESTRICT keys and Whop index against counts worked out before it; the app's own SQL afterwards (the views, the snapshot function, the heartbeat on a new-course lesson); a second run and v101 both change nothing; the undo puts every table, constraint, not-null and index back as the dump before the switch had it and moves new-course progress into `archive_v2`; the switch runs again after it; the undo's refusals; both checks change nothing and their expected rows hold; `admin-health.sql` INVARIANT 6 after the switch. Both sections run twice: on the harness's database and on one built from `base.sql` and the real files v92 to v101. Production's key names, team templates, counts and grants are not in it: the preflight reads those. On 2026-10-13: 276 assertions, 0 failed (the run ends `PASS 276   FAIL 0`). It was 188 on 2026-10-12, before sections 20 and 21 were added. With `LESSON_VIDEOS_SQL` set to the path of a filled copy of the video load, seven more assertions run that file, 283 in all. The SQL runs, a second run changes nothing, column types and progress numbers stay put, and the heartbeat function holds against a hostile caller. For v100 (section 18): `lesson_videos` is private and its three constraints hold, a lesson with no `lesson_videos` row is refused, a 2.5x beat is credited in full, the 60 s cap and the first beat's 20 s hold, a forced replay with no time passed gains under half a second, and the function is v97's with exactly five changes. For the lock: the function takes it once, after the student lookup and before the watch row is read; a call holds one exclusive lock, keyed on its own student and lesson, until its transaction ends; and calls served one at a time are credited as one (four calls of 60 s get 60 s between them, and three first calls at the end of a 67 s lesson bank 20 s). The race the lock closes is NOT reproduced: the harness has one connection and cannot fire two calls at the same instant. For the undo: with rows in the table it refuses, says how many and changes nothing; with the table emptied it restores v97's function character for character, drops the table, runs twice, and v100 applies again after it. For the morning kit (section 19): stamp, proof and unstamp run in order with fake ids, the stamp and the unstamp refuse a placeholder left in, the stamp refuses when a lesson it picked holds a video that is not one of the two test ids, no result shows a video id, and the unstamp leaves `lesson_videos` empty. For the course catalog (section 20, 52 assertions): `build:catalog -- --check` exits 0, and exits 1 on a copy of the data file with one title edited; the generator refuses eight bad data files and writes nothing, three of them a brief with a link (an `http` address, a bare domain, a `www.` address); v101 turns v94's 145 placeholders into the 141 lessons, row for row as the data file has them, writes no length, leaves the live catalog untouched and on a second run changes no column but `updated_at`; a copy that would retitle or drop a lesson with a video row is refused, so is a copy that would turn such a lesson into a `setup` lesson, so is a run while a video row waits on a course id that has no lesson yet, and so is a first run while a watch row sits on a placeholder lesson; it runs on a database v100 has not been applied to; the undo refuses while a video row or a watch row points at a course lesson, and otherwise puts back what v94 and v99 left; `course-catalog-check.sql` returns the expected table and each of its four checks moves when a bad row is planted. For the video load (section 21, 36 assertions), with made-up ids: the template is refused as tracked; every kind of bad list is refused with nothing changed, a list with one wrong title among them; a first load of 5 lessons, the same list again, a lesson given another video, a lesson dropped from the list and a video moved to another lesson each end as the list says; a course lesson that is not in the list loses its length whatever its type; a test stamp on the live lesson `l004` is untouched through every load, and a list holding that video is refused; the data route's and the video route's reads find exactly the loaded lessons; a heartbeat for a loaded staging lesson is still refused before the cutover; a course lesson placed in the live table gets and loses its length there with the list, and is held to the title it has there; and the load is refused where v100 or v101 has not run. v99 runs as a step of section 20, and nothing checks what it wrote. It proves nothing about production: how Supabase grants a new table to `service_role`, or the SQL editor running a block and a select on one connection. |
| Student screens simulation | `node client-tests/student-screens-sim.test.mjs` (once before the first run: `npm install` in `world-tests/`, for puppeteer-core; Chrome from `CHROME_PATH` or the system one) | No. No database, no login and no network either | The real Playbook page, the map's corner (`WorldCorner.tsx` with its real `useWorldBadges.ts` and `corner.module.css`) and the closed-membership card (`MembershipBlockOverlay.tsx`), mounted in headless Chrome and driven with real clicks and keys (2026-10-20): the Playbook page holds its redirect and says "Your course didn't load." while the student's data failed to load (T-026); a sign-out that did not happen shows "Couldn't sign you out." in the corner's list (from the pill, from the list, and when the list was closed while the request was out) and on the card, and one that works shows nothing (login-5). AuthContext, StudentContext and Supabase are stand-ins: `sign-out.test.mjs` runs the real AuthProvider on the real auth-js, `student-context.test.mjs` the real StudentProvider. 21 checks, about 10 seconds. Not in `npm run test:client`. |
| Lesson player simulation | `node world-tests/lesson-player-sim.mjs` (`S3 S5` for some sections) | No. No database, no login and no network either | The real `LessonPlayer.tsx`, `tella-player.ts`, `watch-heartbeat.ts`, `tella.ts`, `lesson-transport.ts` and `call-gate.ts`, loaded into headless Chrome and driven through whole visits to a lesson: watched through, skipped then watched at 2.5x, a claim that is refused, held back, failed or slow, a resumed lesson, a video that says nothing or whose frame never loads, a change of lesson, the real transport's two requests, a lesson that ends without reaching its 95% point, an end heartbeat that fails, a lesson the catalog disowns for a moment while it plays, and a page whose main thread is held up while the video plays on. 138 checks on the code as it stands after decisions D14 to D19 (run 2026-10-12). About 5 minutes. It proves nothing about what Tella really sends or obeys: the frame is a stand-in written from the PRD's contract, and the server is a stand-in too. |
| Lock check, live | `node world-tests/tella-lock-live.mjs` | No. It needs the network and `TELLA_API_KEY`, `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` in `.env.local` | `fetchTellaVideoFacts` and `judgeLock` from the real source against the two real test videos: two `GET` requests to Tella's API that change nothing, each given up after 10 s, and nothing written anywhere. It has no catalog to read, so it judges both videos as a `watch` lesson 67 s long, the length the stamp file gives the two test lessons; it fails on the length rule if a test video is recorded again at another length. It expects both videos `open` with one problem naming `localhost`, and both `locked` once `localhost` is expected. It prints how long Tella took to answer, and neither the key nor an id. It proves nothing about the cron route around that logic (the table read, the writes, the alert), and the `missing` verdict has only run against a stubbed answer. Its last recorded run (project log, 22:19) was before it judged against a catalog length. **Run again on 2026-10-13 it fails: `PASS 0   FAIL 2`, both videos judged "Tella no longer has this video."** The key in `.env.local` was changed that day to the workspace that holds the course, and Tella answers 404 to it for the two test videos, which were made under the earlier key. The two test videos still play on the development page (`tella-watch.mjs` passed the same evening). The locks of the course's own videos are proved by the Tella tool's `check`, outside this repository. |
| Lock check simulation | `node world-tests/lock-check-sim.mjs` | No. No database, no network and no `.env.local` either | The lock check's real route file (`src/app/api/cron/check-lesson-videos/route.ts`) with the real `tella-lock.ts`, `tella-api.ts`, `cron-auth.ts` and `discord.ts`, loaded as they are and run against stand-ins for `fetch`, the Supabase client, `NextResponse` and the clock. On 2026-10-12: 89 checks, 0 failed, in under a second. It proves the route's own logic: the refusals (401 without the secret, 500 without the key or the domain list, 500 when the table of videos cannot be read); one row of every kind with its verdict, its sentences and what is written; the write filtered on the lesson and the video; a row swapped or deleted while the run is on; the 270 s budget, with no request started after it, `notReached` saying how many were left and the next run starting with them; the pace of one request per 700 ms, 86 a minute at most; when the alert is sent, what it says and its cut at whole lines under Discord's limit; a catalog table that cannot be read, a write that fails and an alert that does not go out, with what `cron_runs` says after each; and that no video id and no key is in any answer, alert, `cron_runs` row or log line. It proves nothing about real Supabase (how supabase-js and PostgREST treat the order and the two filters, row level security, how long a write takes), real Tella, real Discord or Vercel's clock. Every timing in it is an input on a pretend clock, so it confirms the arithmetic of how many videos fit and measures nothing. |
| Phones' text fields | `node world-tests/phones-input-zoom.mjs` | No. No database and no network either | The action item's Discord link field and the 30% form's text answer in headless Chrome (phones-2, 2026-10-20): the real `world-ui.module.css` and `discount-form.module.css`, with the world's tokens and `globals.css`, each field focused, on a phone (touch emulation, 390x844) and with a mouse (1366x768). On 2026-10-20: 16px on the phone, so iOS Safari does not zoom in; 13px and 15px with a mouse; the same files at 70c934a read 13px and 15px on the phone. 10 checks, 0 failed, in under 2 s. It proves the size Chrome's own cascade gives each field. The zoom itself is WebKit's: one tap on a real iPhone settles it. `client-tests/phones-input-zoom.test.mjs` checks the same from the source. |
| Tella browser proof | `node world-tests/tella-watch.mjs` | Yes, on port 3111, with `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` in `.env.local`, and the network | The real `LessonPlayer` against Tella's real player, on `/dev/world-app` with a pretend student and a stand-in for the server. Nine rows from the PRD's path table: watched start to finish (T1), skipped to the last 3 s (T2), skipped then watched from the start (T3), watched at 2.5x from the player's own menu (T4), left at about 20 s and resumed (T5), a video Tella refuses (T6), a lesson with no video (T7), no request to `/api/student/*` and a paused map while playing (T8), and `v6-app.mjs` still passing (T9). Five gaps print as NOT COVERED: the real route, database function and completion on production (G1), a lapsed member or a caller with no login being refused (G2), other browsers, devices and a real click (G3), a background tab (G4), the alert reaching Discord (G5). On the code as it stands after decisions D14 to D19: `PASS 9  FAIL 0  NOT COVERED 5` (run 2026-10-12, 23:38 to 23:45). The script tells the end of a video by position, because the real player was seen to end one replay on `paused` with no `stopped` after it; a run made before that change failed row T3 on the wait alone, with the lesson correctly counted on the page. |
| Offline v6 map tests | `node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/<file>` for `v6-route.mjs`, `v6-gate.mjs`, `v6-gate-wait.mjs`, `v6-locked.mjs` and `v6-a2-foundations.test.mjs`. `v6-rail.test.mjs` takes the same flags plus `--expose-gc`. | No | The map's route, camera rail, cave, gate, locked stretches and quality logic, measured from `src/lib/world-v6/` with no browser (`v6-gate-wait.mjs`: the last island is not drawn until the flight, so the rail's switch at the moored deck must never show at 16:9, 1.92, 2.79 or 3.4, and the Ad Bounty's click-in parks before it; with `--app` it also checks the scene on the dev server, the parks included). Each exits 1 on a failed check. |
| Dev map page checks | `node world-tests/v6-ui.mjs checks` | Yes, on port 3111 | The interface of `/dev/world-v6`. The script launches Chrome with a software renderer (SwiftShader), so the page runs in poster mode: it covers the interface and leaves the live 3D path uncovered. |
| World browser proof | `node world-tests/v6-app.mjs` (`--only 3,5,18` for some rows) | Yes, on port 3111 | 23 rows on `/dev/world-app`, on the real GPU: arrival (the welcome's Continue since 2026-10-19), Watch, finishing a lesson and a place, deep links, unknown addresses, the phone view, poster mode, reduced motion, the four not-ready cards, and since the second Loom (2026-10-16) nothing left on screen where a marker was (21) and a resize to the phone list and back (22), and since the launch night (2026-10-19) the welcome at the start (23: the words, Continue by the keyboard, the scroll cue, gone once scrolled in, back at the top, the phone's two lines). It takes about 3 minutes, and three gaps print as NOT COVERED (a real login with a real video, other browsers and devices, the `look` and `locked` modes with a real student). The default catalog it walks is unchanged by the course mode: `PASS 20  FAIL 0  NOT COVERED 3` on 2026-10-13 (course-catalog project log). On 2026-10-16, after the second Loom's map-ui pass: `PASS 22  FAIL 0  NOT COVERED 3`, and the same in the final pass on 2026-10-17, and on 2026-10-19 with the action item rule (an action item with a video stops holding the student once its video is watched). With the welcome (2026-10-19): `PASS 23  FAIL 0  NOT COVERED 3`. With the night posters (2026-10-21, `night/map-night` on port 3430): `PASS 23  FAIL 0  NOT COVERED 3`, the console clean (row 20). With the morning (2026-10-21, port 3480): `PASS 23  FAIL 0  NOT COVERED 3`. Row 21 is sensitive to timing: one fixer saw it fail 2 runs out of 3 while other agents were saving files. |
| Course browser proof | `node world-tests/v6-course.mjs` (`--only 2,4` for some rows) | Yes, on port 3111. Rows 9 and 12 also need `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` in `.env.local`, and the network | 28 rows on `/dev/world-app?catalog=course`, on the real GPU (23 and 24 since the second Loom, 2026-10-16: a lesson with no video never holds a student, said once per place under the panel's count line, and a place's minutes count its action items' lengths; 25 since its fix round: a place finished right before one the map passes over gets a done card that names it alone): the map takes the real counts, every lesson has a lantern, each place's card, each place's panel, the action items, the pond, the total, 26 ticks fitting the card, a lesson page with a video, a lesson page without one, an action item's page, a course lesson watched to the end of the test clip, and since 2026-10-14 four rows on `?text=sample` for the lessons' text (a5l22 with no video: no player and no 16:9 box, the text right under the Milestone box; a5l08: the player, the Milestone box, then the text; the https link opens in a new tab with `noopener` and the `javascript:` one is no link; a7l01 with no video and no text: "Not recorded yet." on one short line), and two rows for action items with a Discord link, done the way a student does them (21: on a5l23, its video marked watched first, a thread's own link is refused, a message link is saved and the lesson completes; 22: on a5l23 the lesson is done only with both halves, the video and the complete button once the link is saved, in either order; since 2026-10-19 the video alone lights "Next lesson" while the hand-in stays open, and the button alone does not; until 2026-10-22 they were on a5l22 and a5l08, both now the Done kind), and since 2026-10-22 (branch `night/action-done`) three rows for the action items with nothing to post (26: on a6l03 the block is one button, Done, with no field, no link and no word of Discord on the page; a real click makes the lesson done, puts "Completed on <date>." alone in the block, lights "Next lesson", which opens a6l04, and back on the map AI Ads + Content counts it, row 3 done and "1 of 22 · 21 to go"; 27: a5l23, the Static Ad Brief, still asks for the link, Save with nothing in the field refused in the route's words and "Complete the action" only once a link is saved, never a Done button, then the pages of the 9 other action items opened and each one's kind read: the seven, `a5l08`, `a5l12`, `a5l22` and the four of AI Ads + Content, the Done kind, `a3l17` and `a3l25` the Discord kind; 28: on a5l08, which has a video, Done pressed first says "Action completed on <date>. Watch the video to finish the lesson.", the lesson not done and "Next lesson" off until the video is watched, then done; the video watched first lights "Next lesson" with Done still offered, and Done then finishes the lesson). Six gaps print as NOT COVERED (how the eight stops look with the real names, which a person judges from the screenshots; the default page, which `v6-app.mjs` proves; lanterns in uncleared ground cover; the real login and the real server; how a lesson's text looks, from two screenshots; how an action item's block looks, the Discord kind and the Done kind, from the pictures rows 21 and 26 to 28 take). On 2026-10-13: `PASS 11  FAIL 1  NOT COVERED 4` (course-catalog project log). On 2026-10-14: `PASS 15  FAIL 1  NOT COVERED 5`; with rows 17 to 20 added the same day (the video asked for before the click: a hovered row is asked for once and its frame is in the page within 300 ms of the click, also with `?latency=1500`; the "Loading video…" placeholder until the player's first word, with a screenshot, `lesson-video-placeholder.png`; a lesson with no video is never asked for), `PASS 19  FAIL 1  NOT COVERED 5`. Until the second Loom's second fix round the 300 ms included the dev server's route change to the lesson page, so rows 17 and 20 missed it on a busy server (316 to 717 ms on 2026-10-16, the router's `_rsc=` request; under `next dev` nothing is prefetched, `_practices/nextjs.md`). Since 2026-10-17 the stage draws the lesson page at the click and the address follows (`WorldStage.tsx`, `open()`): row 17 reads 47 to 50 ms and row 20 24 to 41 ms, the rows print when the address followed and the server's answer, and row 17 checks that the address does follow and that the page and its frame are put in once. Row 2 failed until the map review of 2026-10-15 (place 3 put down 19 lanterns for 25 lessons, task T-054). Since that review's item 12 it passes: one lantern per lesson in every place, 8, 11, 25, 17, 26, 22, 18 and 13, evenly spaced along each place's walk, none in water (`--only 2` on 2026-10-15 at 16:39: `PASS 1  FAIL 0`). Since the second Loom (2026-10-16) it expects 8, 11, 25, 17, 26, 0, 18 and 13: AI Ads + Content's 22 lessons light the 20 floating steps from the bottom instead (counted by lit steps), 4 of Creative Strategy's 18 stand on posts at the rope bridge's railing, and the Introduction, AI Ads + Content and (since its fix round 2) Creative Strategy have no waking lamps. The counts, the place names, the action items and the pond row it expects are typed into the script, and the titles and briefs are read from the data file. About 9 minutes (42 page loads on 2026-10-16). At `3678190` (2026-10-14, that commit's message): `PASS 21  FAIL 1`, the same lantern row. On 2026-10-15, after the map review's first round of fixes (the verifier, in two halves with `--only` 1 to 11 and 12 to 22, because one row can take 6 minutes): 22 passed, 0 failed, the same six gaps printed by both halves. On 2026-10-16, after the second Loom's map-ui pass (rows 23 and 24 added): `PASS 21  FAIL 3  NOT COVERED 6` in one run, then `--only 3,17,20` `PASS 3  FAIL 0` (row 3 needed `standAt()` to mark every other place for Creative Strategy, which the map now passes over; rows 17 and 20 missed the 300 ms on the dev server's route change, 409 and 316 ms). After that Loom's fix round the same evening (row 23 checks the count said once and the rows marked by look, row 25 added): `PASS 22  FAIL 3  NOT COVERED 6` in one run while other builders' saves kept the dev server compiling (rows 17, 19 and 20), then `--only 17,19,20` `PASS 1  FAIL 2`: rows 17 and 20 at 625 and 525 ms, 606 and 598 of it the dev server's answer, the frame 18 and 7 ms after the page. On 2026-10-17, in the second Loom's final pass (`6706d48` plus both fix rounds): `PASS 25  FAIL 0  NOT COVERED 6`; rows 17 and 20 take 47 and 26 ms from the click to the lesson, because the lesson page opens at the click (the `/world/[areaId]/[lessonId]` row under Student Surfaces). On 2026-10-19 (13:04 to 13:12), with Music Leverage's length in the lengths file: `PASS 25  FAIL 0  NOT COVERED 6`, row 23 counting 19 lessons with no video. Later that day, with the action item rule (row 22 rewritten: the video alone lights "Next lesson", the hand-in still open): `PASS 24  FAIL 1  NOT COVERED 6`, the failure row 12 (the player gave no position after "play"), stopped in the minute a save to `map-model.ts` reloaded the dev server under it; `--only 12` right after: `PASS 1  FAIL 0`. On 2026-10-22 on `night/action-done` (a dev server on port 3510 with no `.env.local`, so no test video; 54 page loads, 6 minutes): `PASS 20  FAIL 3  NOT COVERED 10`. Rows 26 and 27 pass. Rows 12, 17, 18 and 20 are not covered and rows 9 and 14 fail for want of the test videos. Row 25 fails on its first check: a done moment has already played before the last lesson is marked ("Introduction to Static Ads done." once the map is ready, for the places the harness marked done before it was live), while the done card the row is about reads right. Rows 9, 14 and 25 fail the same way on `1c9c9a0` (world-engine) with the change stashed, so none of the three is the change's; whether a real student sees such a moment on load was not checked. Later that day, after the adversarial check's fix round (the Whop writers give the four their action half; no page changed), the same server set-up: `PASS 20  FAIL 3  NOT COVERED 10`, the same rows passing, failing and not covered. Later that day, with three of Static Ads on the Done-only list (rows 21 and 22 and row 27's link item moved to a5l23, row 28 added), the same server set-up (56 page loads, 0 page errors, 0 requests to `/api`, about 6 minutes): `PASS 21  FAIL 3  NOT COVERED 10`. Rows 21, 22, 26, 27 and 28 pass; rows 9, 14 and 25 fail as before, row 25's two failed checks word for word the earlier run's; rows 12, 17, 18 and 20 are not covered. |
| Discount checkpoint proof | `node world-tests/v6-discount.mjs` (`--only 1,3` for some rows) | Yes, on port 3111. Row 18 also needs `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` in `.env.local` | 28 rows on `/dev/world-app?catalog=course&discount=<state>` (`&questions=none` or `fail` for two of them; row 18 the plain page), on the real GPU: the header chip (a part of the header's group on the right since 2026-10-15) and the timeline's tag when locked; the cache and its marker in the world; the marker, the tag and the chip each opening the panel (the chip from the opening frame, jumping the scroll to the cache); the locked panel with the deadline and its hour (2026-10-17), no time estimate and no Watch row, and Apply greyed out with its reason ("Watch all 61 videos to apply", 59 until Music Leverage's video on 2026-10-19 and 60 until Your Editing Software's later that day); Esc back to where the camera was; the locked Apply taking nothing (a click, Enter and Space open nothing and send nothing); ready, Apply opening the application's questions in the panel's slot, answered and sent (in memory), in review; pending and approved; the lantern lit in Video Ads II; a student the offer is closed to (a first payment before 1 October, the deadline over) and one with no first payment ("Ask the team"): no chip in the header, the tag and the marker shown, each opening the panel that says why (the owner's second Loom, 2026-10-16), grey when closed, never sand (its second fix round, 2026-10-17); the questions one at a time (a required one holds Next, Back keeps the answer, the answers sent are exactly the ones given); Esc, Cancel and a click beside the form leaving it with nothing sent; a refused send; no active questions sending the plain request; the phone's full sheet; applied and rejected; the plain page as the owner reviewed it; the phone's row under Video Ads II; the approved celebration on a 360 px phone (one line, how to close it, the map's words, reduced motion); poster mode's plaque for the Ad Bounty, and none for the 30% (it shows only near the cache, 2026-10-17), whose tag opens it there; a new scene under the open checkpoint parking at the cache again; the far cache (23, 2026-10-17): no 30% plaque at the opening or at the Introduction's stop on 16:9 and wider windows, the Introduction's card keeping its side, the plaque up near the cache; T-080's shared group (24 to 26, 2026-10-17, loaded in Europe/Zagreb; a first payment on 2 October since the first date moved to 1 October on 2026-10-19): "Apply by Fri 23 Oct, 23:59", "5 days left" and the rule's one line (since 2026-10-20 the same as every student's, "Finish every video through Video Ads II within 2 weeks of joining to apply.", with no sentence about the shared group), and on the phone's sheet the student's own hour (Fri 23 Oct, 17:59 in New York, Sat 24 Oct, 05:59 in Manila); the same student after the deadline, "This closed on Fri 23 Oct, 23:59." and the rule, never "your first 14 days"; their application from the old dashboard, of 6 October, as Yours, In review and Approved, in words for an application made before the new course opened, with no Apply; a September joiner (27, 2026-10-19): no chip, closed, "Your 2 weeks have passed." and the rule (until 2026-10-20 "This offer is for students who joined from 1 October 2026, Croatia time"), no Apply, on the phone's sheet too. Then 0 requests to `/api`, 0 to Supabase and 0 page errors. `PASS 10` in `d11d215` and `3678190`; `PASS 15` on 2026-10-14 night with the questions; `PASS 15  FAIL 0` on 2026-10-15 at 16:41, after the map review's panel changes; `PASS 20  FAIL 0` on `6706d48`; `PASS 22  FAIL 0` on 2026-10-16 at 20:24, after the second Loom's fix round; `PASS 23  FAIL 0` on 2026-10-17 at 04:39, after its second fix round; `PASS 26  FAIL 0` on 2026-10-17 in the release integration (07:06 to 07:12, and again in its verifier's run); `PASS 27  FAIL 0` on 2026-10-19 (11:12 to 11:19), after the first date moved to 1 October; `PASS 27  FAIL 0` again (12:56 to 13:04), after the shared deadline's lines named "from 1 October until the new course opened" and the closed line "1 October 2026, Croatia time". `PASS 27  FAIL 0` again (13:12 to 13:20) with Music Leverage's length in the lengths file: "Watch all 60 videos". On 2026-10-20 (branch `night/thirty-copy`) the rule's words changed to the one line in rows 3, 10, 19, 24, 25 and 27. Run the same day on a second dev server from that branch's worktree (`PORT=3344 npm run dev` with no `.env.local`, `BASE_URL=http://localhost:3344`): `--only 3,10,19,24,25,27` `PASS 6  FAIL 0` (15:14 to 15:15); with the locked line swapped for the closed one and the rule taken out of the no-payment line, rows 3, 10 and 19 each failed (`PASS 0  FAIL 3`); the whole walk `PASS 26  FAIL 1` (15:16 to 15:21), the failure row 18: with no dev videos the plain page's course has no video up to its gate, so its plaque reads "30% off" and "Not open yet", and the row's marker check has no case for that, where its chip and panel checks do. Since T-080 the dev page also has `?discount=october`, `october-expired` (a first payment on 2 October, the clock held at 19 and 24 October), `october-old-course`, `october-old-course-pending` and `october-old-course-approved` (the same student's request of 6 October: applied, in review, approved), all named `september…` with a payment on 15 September until 2026-10-19; `september` now pays on 15 September and is closed, and `before-launch` pays on 5 September; rows 24 to 27 read them in Europe/Zagreb, row 24 also on the phone's sheet in New York and Manila. Row 28 (admin rebuild 2, D5, `has-discount`): every video watched and a discount already on the student's Whop membership: no chip, the tag and the marker closed, and the panel, opened by a real click on the tag, says "You can't apply for this discount because you already have a discount applied to your account." with "Closed" in its eyebrow and no Apply, at 1440x900 and on the phone's sheet at 390x844; on 2026-10-20 on `night/admin2` with the 5 lanes merged (a dev server on port 3409 with no `.env.local`, `--only 28`): `PASS 1   FAIL 0`, 0 requests to `/api` or Supabase, 0 page errors. On 2026-10-21 after the review's fix round (port 3411, no `.env.local`), `--only 8,28`: `PASS 2   FAIL 0`; row 8 reads the application's question 1 as "On a scale of 1 to 10, how likely are you to recommend Ecom University to a friend?", the words `messages_v2.sql` gives the live row. On 2026-10-21 for T-122 (`night/admin3`, port 3520 in the branch's worktree, no `.env.local`), the whole walk: `PASS 27  FAIL 1`, the failure row 18 as above (no dev videos: the plaque reads "30% off" and "Not open yet"), 50 pages, 0 requests to `/api` or Supabase, 0 page errors; `--only 18` on `0601b82` with the change set aside fails the same way. T-122 changes nothing the dev page shows, its student's discount coming from `?discount=`. On 2026-10-21 for T-122's fix round (`night/admin3`, port 3520 in the branch's worktree, no `.env.local`, 14:52 to 14:58), the whole walk: `PASS 27  FAIL 1`, the failure row 18 as above and its only one, 50 pages, 0 requests to `/api` or Supabase, 0 page errors; the round changes nothing the dev page shows either. On 2026-10-22 for T-122's fifth fix round (`night/admin3`, port 3520 in the branch's worktree, no `.env.local`, 15:22 to 15:28), the whole walk: `PASS 27  FAIL 1`, the failure row 18 as above and its only one ("30% off" and "Not open yet" at the cache), 50 pages, 0 requests to `/api` or Supabase, 0 page errors; nothing the dev page shows changed. On 2026-10-22 for T-122's fourth fix round (`night/admin3`, port 3520 in the branch's worktree, no `.env.local`, 13:46 to 13:51), the whole walk: `PASS 27  FAIL 1`, the failure row 18 as above and its only one ("30% off" and "Not open yet" at the cache), 50 pages, 0 requests to `/api` or Supabase, 0 page errors; nothing the dev page shows changed. On 2026-10-22 for T-122's third fix round (`night/admin3`, port 3520 in the branch's worktree, no `.env.local`, 11:31 to 11:36), the whole walk: `PASS 27  FAIL 1`, the failure row 18 as above and its only one ("30% off" and "Not open yet" at the cache), 50 pages, 0 requests to `/api` or Supabase, 0 page errors; nothing the dev page shows changed. On 2026-10-21 for T-122's second fix round (`night/admin3`, port 3520 in the branch's worktree, no `.env.local`, 16:13 to 16:18), the whole walk: `PASS 27  FAIL 1`, the failure row 18 as above and its only one ("30% off" and "Not open yet" at the cache), 50 pages, 0 requests to `/api` or Supabase, 0 page errors; nothing the dev page shows changed. On 2026-10-21 on `night/preview-2026-10-21` (`night/admin2` with `night/map-night` and then `night/login1-main` merged; port 3460, no `.env.local`), every row: `PASS 27  FAIL 1`, 50 pages, 0 requests to `/api` or Supabase, 0 page errors. The one failure is row 18's plaque check: with no `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` the placeholder course has no video before its gate, so the plaque reads "30% off" with "Not open yet" where the row wants "30% off" alone. Row 18 fails the same way on `world-engine` at `d0ebe76` with no `.env.local` (`--only 18` on port 3461), so the ids are missing, not anything the merges did. It proves nothing about the request routes, the database or a real student's first payment. About 6 to 7 minutes. Pictures in `world-tests/shots/v6/discount/` (the form: `form-map.png`, `form-choice.png`, `form-text.png`, `form-refused.png`, `form-phone.png`, `form-phone-choice.png`). |
| Corner proof | `node world-tests/v6-hud.mjs` (`--only 1,3` for some rows) | Yes, on port 3111 | 11 rows on `/dev/world-app?catalog=course&hud=<state>` (`cold`, `some`, `long`, `all`, `fresh`): the pill per state, the list (tiers, shares, the two hidden ones), a fresh unlock's toast, the corner over an open place and the checkpoint, the keyboard, Sign out (counted by the stand-in), hidden under a lesson page with the toast waiting, through the telescope, a wide screen and a phone, and since 2026-10-15 the streak's moment in the pill (11: the number stays inside the pill and nothing around it moves, at 1691 px and on a phone). Then 0 requests to `/api`, 0 to Supabase and 0 page errors. `PASS 10` (`3678190`'s message); `PASS 11  FAIL 0` on 2026-10-17 (the second Loom's final pass, `6706d48` plus both fix rounds), and again in the release integration, where the list's streak line reads "Finish a lesson every day to keep it going." (row 2). On 2026-10-21, on `night/achievements`, with the dev page's catalog of v112's eight (the pill reads 0/8, 3/8, 4/8, 6/8 and 8/8, the list eight rows in four tiers): `PASS 11  FAIL 0` on a dev server on port 3510 (`BASE_URL=http://localhost:3510`). It proves nothing about the real achievement reads or a real sign-out. About 4 minutes. Pictures in `world-tests/shots/v6/hud/`. |
| Playbook link proof | `node world-tests/v6-playbook.mjs` | Yes, on port 3111 | 4 rows on `/dev/world-app?catalog=course`, with and without `?playbook=1`: no link and no empty slot without it; with it a link labelled Playbook to `/dashboard/playbook` inside the header's right-hand pill (since 2026-10-15 the one group at the right end), after the stats and the discount and before Sign out, the pill clear of the brand, reached by Tab after the discount with the focus ring; on a 390x844 phone the stats stay in the header's row and the link drops to the row under them with the discount chip, both inside the screen and apart; wide. Then 0 requests to `/api`, 0 to Supabase and 0 page errors. `PASS 4` (2026-10-14 night); `PASS 4  FAIL 0` on 2026-10-15 at 16:42, with the new header. It proves nothing about the real Playbook page after the switch (ship order step 11). About 30 seconds. Pictures in `world-tests/shots/v6/playbook/`. |
| Celebrations proof | `node world-tests/v6-celebrations.mjs` | Yes, on port 3111 | 16 rows on `/dev/world-app?catalog=course&celebrate=1` with `?hud=` and `?discount=approved` (row 16 `?discount=october-old-course-approved`, named `september-old-course-approved` until 2026-10-19; since then the row also checks the preset loaded, since an unknown one falls back to locked and the row would pass on nothing: `PASS 1  FAIL 0` on 2026-10-19): a streak never celebrated here fires once and is recorded under the dashboard's key, a reload does not bring it back; a streak going up while the map is open fires once; a key the dashboard already wrote stops it; the approval the same way, once the map is up; one at a time; nothing without `?celebrate=1`; the dashboard's test events; over a lesson page; a phone; reduced motion (10); through Creative Strategy's telescope (11); a phone's long list (12); since 2026-10-17 a streak of 5 broken to 0 then 1, the moment once at 1, and a new 1 after an old 1 (13), a break the browser never saw at 0 (14), the approved 30% waiting out a lesson page (15), an approval of an application made on the old dashboard before the new course opened: no celebration and nothing recorded in the 10 s after the map is ready (16). Since 2026-10-15 the streak's moment is the number's rise in the header's pill (600 ms at most, no full-screen moment), and since 2026-10-16 every moment must start in sight (the loading screen gone, no telescope up, the pill on screen). Then 0 requests to `/api`, 0 to Supabase and 0 page errors. `PASS 9` (2026-10-14 night). On 2026-10-17, in the second Loom's final pass (`6706d48` plus both fix rounds): `PASS 10  FAIL 2`, rows 4 and 5, and run alone `PASS 1  FAIL 1` (row 4 again): the approved-30% celebration opens over the loading picture and closes on its own 5 s timer before the rows read it, now that the busy dev server's map is ready later. The test and the timer did not change; the final pass would make the celebration wait for the map (`_admin/prds/map-review-2026-10-15/final_pass.md`, sections 7 and 8). On 2026-10-17, in the release integration, it does (`useMapUp`): `PASS 15  FAIL 0` at 06:52 (load 7.4), and rows 4 and 5 alone 3 runs in a row, `PASS 2  FAIL 0` each; the celebration opened with the loading screen at opacity 0. In its fix round (09:22 to 09:27, load 4.0 to 5.9): `PASS 16  FAIL 0`, then rows 4, 5 and 16 twice more, `PASS 3  FAIL 0` each; row 16 fails on the code before the fix (the celebration opened over the built map and wrote the old request's id). On 2026-10-21, on `night/achievements` (the pill's count 4/8, v112's eight): `PASS 16  FAIL 0` on a dev server on port 3510. It proves nothing about a real student's streak refresh after a video (that is `StudentContext.markWatched`, which the page does not mount). About three minutes. Pictures in `world-tests/shots/v6/celebrations/`. |
| Night rows of the stop tests | `node world-tests/v6-gates.mjs --night` (`--night sheet` for the sheet; `--only k0,a5` for some rows) | Yes, on port 3111 (`/dev/world-v6?poster=off&tod=night`, on SwiftShader) | The opening and a1 to a6 at night, 960x600, read from the GL buffer with an ID pass: readable (pixels under luma 50 at most 62% at the opening to 88% in the forest; the scoping doc found about 4 in 5 at the opening under the world's own night), the lanterns brightest (the warm light's 95th percentile at least the 99.5th of the rest of the land, sky and water left out; the forest, which has no lanterns, its glow), no white beach (where a beach is in frame its 90th percentile at most 105: 79 and 81 with the night's sand, 133 and 131 with the day's), the landmark in frame. On 2026-10-20 night: 30 of 30. After the tune pass (2026-10-21, `night/map-night`): 30 of 30, Base Camp at 63.3% very dark against its 65 (its meadow went darker on purpose, the critique's ask). With the morning built (2026-10-21, port 3480): 30 of 30, Base Camp at 63.3% again (the night unchanged). The day rows (`--batch 0` and `1`) open the page with `?poster=off` too: since the cheap laptops' poster mode SwiftShader counts as a software renderer, and the script drew nothing. |
| Morning rows of the stop tests | `node world-tests/v6-gates.mjs --morning` (`--morning sheet` for the sheet; `--only k0,a5` for some rows) | Yes, on port 3111 (`/dev/world-v6?poster=off&tod=morning`, on SwiftShader) | The opening and a1 to a6 (2026-10-21), each drawn twice in one page, by day and then in the morning (the light module set straight to each), the morning graded against its own day: the lamps out (every lamp material at most 0.15 of its lit colour, read from the scene; the Landing's halos and the lake's lamps at 0; the star field hidden), softer shadows (no more very dark pixels than the day's, the darkest 5% no darker), cooler (the frame's blue less red 8 or more over the day's, its sky no warmer), brighter (mean luma at least the day's), and the day rows' landmark and edge gates. The day frame is saved beside the morning one (`{id}-day.png`). On 2026-10-21 (port 3480): 42 of 42 (the brightest lamp at 0.108 of its colour where by day it is 0.4 to 1; the opening's very dark pixels 0.4% against 2%, its blue less red 26 against 10). After the morning's tune pass (2026-10-21, port 3480): 42 of 42 (the opening's blue less red 24.9 against 10 and its mean luma 164.1 against 147.8; the Landing's mean luma 152.7 against 143.7; the narrowest margins are Base Camp's coolness, 17.6 against 8.6 + 8, and the Mirror Lake's very dark pixels, 5.6% against the day's 6.4%). With the morning haze and its posters (2026-10-22, port 3480): 42 of 42, twice (the opening's blue less red 25.8 against 10 and its mean luma 173.5 against 147.8; the narrowest margins are Base Camp's coolness, 17.8 against 8.6 + 8, the opening's sky, 66.5 against the day's 66.9 with 2 allowed, and the Mirror Lake's very dark pixels, 5.6% against the day's 6.4%). |
| Night on the page | `node world-tests/v6-night.mjs` | Yes, on port 3111 (`/dev/world-v6`, the real GPU) | The clock's wiring, on a stand-in Date: the dev page stays on day at 23:00; `?tod=clock` at 23:00 is night from the first frame; 20:00 to 20:30 on coming back to the tab gives 0.5 and, with the map awake, eases in; with the map asleep a change lands in a frame or two and the map sleeps on; at tier 3 the lake's kept reflection is drawn again when the light changes with the camera still. Since the morning (2026-10-21) also: `?tod=clock` at 07:30 is the morning from the first frame and `?tod=morning` at 23:00 the morning; 05:00 to 05:30 the night eases off the morning (82% night, the morning showing through); 09:00 to 09:30 the morning eases halfway into the day. On 2026-10-20 night: 16 of 16. After the tune pass (2026-10-21): 16 of 16. With the night posters (2026-10-21): 16 of 16. With the morning (2026-10-21, port 3480): 25 of 25. After the morning's tune pass (port 3480): 25 of 25. With the morning haze and its posters (2026-10-22, port 3480): 25 of 25, twice. On 2026-10-21 on `night/preview-2026-10-21`, the morning's preview (`night/admin2` with `night/map-night` and then `night/login1-main` merged; port 3460): 16 of 16. About 2 minutes (it waits for the map to fall asleep). |
| Night posters on the page | `node world-tests/v6-night-posters.mjs` (`--out=<dir>` for the pictures) | Yes, on port 3111 (`/dev/world-app?catalog=course&p=p0&discount=locked&tod=clock`, the real GPU) | The loading posters on a stand-in Date, each load in a fresh browser context, every painted frame from the screencast: 12:00 desktop is day from the first frame and asks for `k0.webp` only, its bytes the file on disk; 23:00 desktop (1691 x 1278) is night from the first frame, asks for `k0-night.webp` and no day poster of a place with a night, and every frame it paints until 1.5 s after the live map took over is nearer the night poster than the day poster; the phone (390 x 844) at 12:00 and 23:00, the loading card's ground and the Landing's picture day and night, at 23:00 no day file and every frame nearer the 23:00 phone than the 12:00 one; 20:30 and 05:30 night; poster mode at 23:00 the 7 night twins and a7, a8 their one file, all loaded; the clock crossing the line with the page open (20:20, then 20:30 on coming back to the tab) turning poster mode's posters, the phone's picture and `<html>` to night; the layout shift of each 23:00 load the same as the 12:00 one's. On 2026-10-21 on port 3430: 27 of 27 (the 23:00 desktop load: first paint 84 ms, the live map took over at 1.58 s, 178 frames painted, none nearer the day; the phone's 15 frames none nearer the day; layout shift 0 at 12:00 and at 23:00 on both). On 2026-10-21 on `night/preview-2026-10-21`, the morning's preview (`night/admin2` with `night/map-night` and then `night/login1-main` merged; port 3460): 27 of 27 (the 23:00 desktop load: first paint 72 ms, the live map took over at 1.54 s, 169 frames painted, none nearer the day; the phone's 18 frames none nearer the day; layout shift 0 at 12:00 and at 23:00 on both). Pictures: `load-2300-desktop.jpg`, `load-2300-phone.jpg` and the frames they hold. About 1 minute. The posters themselves: `node world-tests/v6-posters.mjs --tod=night` (the same script as the day's, it writes only the night files and the manifest's `night` block, and prints the 48 px still for `world.module.css`). Since the morning (2026-10-21) also: 07:30 desktop is the morning from the first frame, asks for `k0-morning.webp` and no day or night poster of a place with a morning, and every frame it paints is nearer the page's morning than its day and its night (the references are the page's own frames at 12:00, 23:00 and 07:30, the poster at 1 s and the live map, since the morning and the day are close enough that the page's shade over the poster's sea weighed as much as the light; a flat frame is the blank ground before any picture, and every other frame is fitted as a fade from it); the phone at 07:30 reads the band where a picture shows, fitted the same way; 05:30 night, 05:40 and 09:15 morning, 09:45 day; poster mode at 07:30 the 7 morning twins; the clock crossing 05:30 to 05:40 and 09:25 to 09:35 with the page open. With the morning haze and its posters (2026-10-22, port 3480, two runs): 52 of 52 both times (the 07:30 desktop load: first paint 80 and 56 ms, the live map took over at 1.69 s, 185 and 188 frames painted, 0 and 1 of them the blank ground, the closest call 30.7 both times, so the hazy morning stands further from the day and the night than before; the phone's 18 and 19 frames, 4 and 5 before any picture, the closest 19.2; layout shift 0 at 07:30 on both; 09:25 still the morning's posters and 09:35 the day's with the line at 0.54). After the morning's tune pass (2026-10-21, port 3480): 52 of 52 (the 07:30 desktop load: 178 frames painted, the closest call 14.1; the phone's 16 frames, the closest 11.7; layout shift 0 at 07:30 on both). Before it, with the morning (2026-10-21, port 3480): 52 of 52 (the 07:30 desktop load: first paint 88 ms, the live map took over at 1.63 s, 183 frames painted, 2 of them the blank ground, the closest call 15.4; the phone's 17 frames, 5 before any picture, the closest 14.6; layout shift 0 at 07:30 on both). Pictures: `load-0730-desktop.jpg`, `load-0730-phone.jpg`. The morning posters: `node world-tests/v6-posters.mjs --tod=morning` (at 07:30; only the morning files and the manifest's `morning` block). |
| Creative Strategy's stars | `node world-tests/v6-stars.mjs` | Yes, on port 3111 | 5 rows on `/dev/world-app`, on the real GPU (map review 2026-10-15, item 13). With the camera parked at the telescope the two constellation meshes are drawn alone and their pixels read, so what is checked is what is drawn: one star per Creative Strategy lesson that counts (18 on the real course, where the Ad Bounty row is not one; 21 on the placeholder course); k watched light exactly the first k (0, 6 and 18), every other star drawn dim, k - 1 lines, each between two lit stars; every star inside the lens's clear circle, right of the panel, under the sky caption and apart from the others, also at 1366x768 and 1024x700. Then 0 requests to `/api`, 0 to Supabase and 0 page errors. `PASS 33  FAIL 0` on 2026-10-15; `PASS 67  FAIL 0` on 2026-10-17 (the second Loom's final pass). About 2 minutes. Pictures in `world-tests/shots/v6/stars/`. |
| Ad Bounty checkpoint proof | `node world-tests/v6-bounty.mjs` (`--only 1,3` for some rows) | Yes, on port 3111 | 12 rows on `/dev/world-app?catalog=course`, on the real GPU (map review 2026-10-15, plan item 18): the board in the world with its "Ad Bounty" plaque and the timeline's tag; the marker and the tag each opening the panel; Creative Strategy's panel no longer listing it; its lesson page; a phone; the camera passing through nothing on the way to the ship and off it; Creative Strategy's last lesson not leading into it; one checkpoint's panel giving way to the other's; its page opened by its address; Apply to Ad Bounties on the panel and on the phone's sheet (rows 11 and 12, Lovro's preview review, 2026-10-19): one link under the lesson to the program's sign-up page, drawn as the 30%'s Apply (measured against it), not faded, reached by Tab from the heading, and Enter and a click each opening the page in a new tab with no opener. The run maps that page's host to this machine (`--host-resolver-rules`), so the new tabs send nothing to it. Then 0 requests to `/api`, 0 to Supabase and 0 page errors. `PASS 10  FAIL 0` on 2026-10-17 (the second Loom's final pass); `PASS 12  FAIL 0` on 2026-10-19. About 3 minutes. Pictures in `world-tests/shots/v6/bounty/`. |
| Review pictures | `node world-tests/v6-review-shots.mjs <label>` (`--only header,w-lake` for some views, `--pose-from <label>` for another run's camera poses, `--p <preset>` for another progress) | Yes, on port 3111 | Not a test: the pictures for Lovro's map review of 2026-10-15 (`_admin/prds/map-review-2026-10-15/plan.md`), taken the same way every run so a before and an after can be laid side by side. 8 interface views at 1691x1278, 3428x1230 and 390x844 and 29 world views at 1691x1278, 53 pictures (the final pass's run `loom2-after-r2`, 2026-10-17: 53 taken, 0 failed, 0 page errors, 0 requests, none blank), on `/dev/world-app?catalog=course` with `?p=partial` (6 lessons of every place watched) and `?discount=locked`, the clocks frozen and the quality tier pinned. It writes `world-tests/shots/v6/review-2026-10-15/<label>/` with a `manifest.json`: per picture the address, how the camera was placed, the Loom moment and what it shows (the before line in a run labelled `before`, the after line in any other). It fails only when a picture cannot be taken. About 6 minutes. |
| Map frame time | `node world-tests/v6-perf.mjs route` (also `bpr`, `bgroups`, `sweep` and `static`; `KEYS=stop3,k20` for some positions; it runs long, so start it in the background and read its `.txt`) | Yes, on port 3111 (`/dev/world-v6`) | The frame time on the real GPU at the 8 stops, the 37 strip frames of `v6-strip.mjs` and 1160 vh (`vh1160`, the descent into the magical forest, where the draw calls peak; `VH=` changes the list, since 2026-10-16), at 1691x1278 and pixel ratio 1.5, against `world_art_bible_v6.md` section 3.1 (5 ms target, 6.7 ms cap a frame), with the triangles, the draw calls, the lake's reflection and the JS of a moving frame. Output in `world-tests/shots/v6/perf/` (`PERF_OUT` overrides). Its frame times move by 0.1 to 0.3 ms with the machine's load, so two runs hours apart cannot say whether a change made the map slower: `v6-perf-ab.mjs` can. The map review's baseline (2026-10-15, before its items 1 to 13): 1.73 to 5.54 ms, no frame over the cap. Its JS of a moving frame read 0 from 2026-09-28 to 2026-10-16 (the frame pacer skipped 19 of its 21 ticks); measured again on 2026-10-16 the Landing is over the cap (k2 2.6 and 2.7 ms, stop1 2.1 to 2.6), everything from Video Ads II on 1.6 or less. `vh1160` on 2026-10-16: 4.29 to 4.41 ms, 66 to 67 draw calls (over the 60 target, under the 80 cap), 1.3 to 1.4 ms of JS. In the second Loom's final pass (2026-10-17): no frame over the cap, the worst k13 at 5.39 ms, k11.5 at 5.01 over the 5.0 target, the module install 721 ms (target 600, cap 800); the turn after the Video Ads II hut reads 5.19 ms at the stop, then 5.56, 5.30 and 5.01 at +10, +20 and +30 vh, and 4.4 or less after that. |
| Map speed, side by side | `node world-tests/v6-perf-ab.mjs` (`--base <commit>`, `HEAD` when left out; `--keys stop3,k20`; `--rounds 4`) | No. It builds both worlds itself and serves them to Chrome from `world-tests/shots/v6/perf-ab/`; it needs `git` and Google Chrome | Whether the working tree's map is slower than a commit's. Both versions of `src/lib/world-v6/` (the commit's from `git archive`, read only) are drawn in one headless Chrome on the real GPU at the same moment and measured in turn at v6-perf's 46 positions with its burst (`PERF_OUT=dir` moves its working folder), then again with the two pages opened in the other order. Slower when the mean difference is over +0.03 ms, or when a position is still over +0.15 ms measured again with 3 times the rounds. The page's interface is not in it (on `/dev/world-v6` it cost about +0.03 ms, shown against hidden). On 2026-10-15, items 1 to 13 against `d7d1a73`: mean +0.004 ms, no position over, `NOT SLOWER`; an A/A run (one commit on both pages) spread 0.06 ms a position. In the second Loom's final pass (2026-10-17) against `14716be`: mean -0.012 ms, median -0.009, slower at 6 of 46, none over +0.15, `NOT SLOWER`. At k39.5, where the turn after the Video Ads II hut changed the camera, it compares both versions from one camera (-0.025 ms); the new view there costs +1.31 ms on its own (2.60 to 3.94 ms). About 7 minutes. Exit 1 when slower. |
| Lower-end computers | `node world-tests/v6-lowend.mjs --size=1366x768@1`, plus `--cpu=4`, `--swiftshader`, `--nogpu`, `--net=slow`, or `--lowgpu` (or `--gpu-name="..."`) with `--gpu-ms=23`; `--table` prints every run | Yes, on port 3111 (`/dev/world-app?catalog=course&p=partial`) | One fresh Chrome a run: the tier the map picked at load and why, whether it went to the still pictures, the first picture and the usable map (ms from navigation), the module install, the longest freeze, the JS heap, the frames the scene drew while the whole route scrolls in 60 s (median, 95th percentile, worst; a display frame the frame pacer skipped is not a frame) and what the page downloaded. `--gpu-ms` makes this Mac's GPU slow with the page's own simulator, set by measurement, because the simulator's own calibration overshoots on a canvas without MSAA (asked for 13 times slower, it made the GPU 39 to 96 times slower). It waits for other Chromes on the machine first. The runs of 2026-10-16 and their table: `world-tests/shots/v6/review-2026-10-15/loom2/lowend/`. In the second Loom's final pass (2026-10-17): tier 0, usable at 5.14 s, modules 664 ms, 3,679 frames at 16.7 ms (worst 16.8); the UHD 620 class at tier 2, pixel ratio 0.85, mean 17.8 ms, 95th percentile 33.3, worst 33.5. It has no pass line. About 75 s a run. |
| Admin pages proof | `node world-tests/admin-pages.mjs` (`--only routes,frame,signin,thirty,dash,tasks,people,feedback,templates,survey,team,insights,review,render` for some parts) | Yes, its own: it opens `http://localhost:3226` by default, a server started for the run in the app root with `PORT=3226 npx next dev` (`BASE_URL` changes it). The dev pages need nothing from `.env.local`; the set-password form is covered only on a server with no Supabase settings, and printed NOT COVERED otherwise; the sign-in that lands on `/admin` needs only that the login page calls Supabase | The admin rebuild's pages (work item 5), each state at 390x844, 1280x720 and 1440x900: `/dev/admin/frame` for a founder, a csm and an admin over a light page and the Dashboard (since admin rebuild 2: the bar Dashboard · 30% off · Tasks · Students · Feedback · Templates · Insights · Team for each role's flags, no More, Dashboard marked on `/admin`, no plan or subscription in it, the lockup to `/admin`; the Menu under 1100px with every entry reachable by scrolling it and one hairline between two groups; the Students and Feedback dropdowns and Escape closing them; at 1100px a founder's bar fitting with the lockup at full size, and with a long name the lockup shrinking and nothing overlapping); `/admin/login` and its refusal (Supabase's answer given in the browser), a sign-in Supabase says yes to opening `/admin`, `/admin/set-password` with no invite, with a made-up invite and with passwords that differ; `/dev/admin/discounts` with its 4 tabs full and empty, partial, novideos, loading and error, then its paths (the verdict beside Approve, Approve anyway, Reject, a 409 on approve and on reject, a failed reload, Mark code added, `?student=`). Today's part went with Today (admin rebuild 2). Every rendered state fails on a horizontal scroll or anything past the right edge, on text under 4.5:1 against the colours really under it (text on a disabled control excepted), and on an em dash, "unlock" or "EcomTalent" in the text, a placeholder, an aria-label, a title or the page's title. It also runs `client-tests/build.mjs` and the route suite with `ADMIN_ROUTE_ERRORS_OUT` and holds every error sentence a route answered to the same words; stops every request to another host in the browser and counts them (0 allowed; the sign-in pages' Supabase calls and the Vercel Analytics script the root layout loads in development are answered in the browser); and allows no console error but the answers it gives itself. On 2026-10-20 at 03:16 (CEST), on `night/admin` with work items 1 to 5: `PASS 719   FAIL 0   NOT COVERED 0`, 152 measured states, the lowest readable text 4.63:1 (the frame's light page, the old pages' look), the lowest on a disabled control 3.11:1, 33 error sentences from the routes (17 different), 0 requests off the machine, 1 minute 35 seconds. Five mutations of the app (a banned word in Today, the tertiary text at 25% on the dark page, the dark pages 1500px wide, a picture from another host, an em dash in a route's error sentence) each made it fail. After the review fixes the same day (04:50 to 04:52 CEST): `PASS 775   FAIL 0   NOT COVERED 0`, 158 measured states, the lowest readable text 4.63:1, 37 error sentences from the routes (19 different), 0 requests off the machine. It now also checks Today's first screen on a phone (the first row whole), every tap at 44px, the focus ring and the dark native controls, a mark low on the page with its notice in the window, one mark at a time on a row; on the 30% page the tabs whole on a phone, To decide oldest first, the code to delete pinned and copyable, a failed reload on its own line with the decided row's buttons off, and Mark messaged closing an open queue task with its Undo. Two mutations (the notices drawn in the page flow, the tabs on one scrolling line) each made it fail. After the ads step was dropped (2026-10-20, branch `night/q3-drop-ads`, a dev server on port 3250 with no `.env.local`): `PASS 779   FAIL 0   NOT COVERED 0`, 158 measured states, the lowest readable text 4.63:1, 37 error sentences from the routes (19 different), 0 requests off the machine. The tick's checks became: no row on To decide has a checkbox or a word about the ads or the action items, Approve is enabled on exactly the rows whose verdict is yes, Approve on a student whose ads were never ticked sends one approve call and nothing else, the Approve anyway confirm names the 30% rule alone, and the Reject reason's example is about the videos. On 2026-10-20 on `night/admin2` (admin rebuild 2, WI-1; a dev server on port 3400 with no `.env.local`): `PASS 657   FAIL 0   NOT COVERED 0`, 120 measured states, the lowest readable text 4.63:1, the lowest on a disabled control 3.11:1, 24 error sentences from the routes (13 different), 0 requests off the machine, 74 seconds; with the sign-in page sent back to `/admin/today`, the landing check fails. On 2026-10-20 on `night/a2-tasks` (admin rebuild 2, lane WI-5 and WI-6; a dev server on port 3403 with no `.env.local`), with the parts `tasks` (Tasks in every state, the Archived rows read only, Mark sent, Dismiss and its reason, Move to To do, Replied, the search) and `people` (the insights, All students, 9 states of a student's page and 6 of the journey, with what each says when a read failed, the drawer opened and closed, every tap 44px, no bold word glued to the next): `PASS 1094   FAIL 0   NOT COVERED 0`, 234 measured states, the lowest readable text 4.63:1 (the frame's light page; on the new pages 5.01:1), 0 requests off the machine. On 2026-10-20 on `night/admin2` with the 5 lanes merged (a dev server on port 3409 with no `.env.local`), every part: `PASS 1587   FAIL 0   NOT COVERED 0` (routes 4, frame 329, signin 62, thirty 283, dash 148, tasks 127, people 310, feedback 121, templates, survey, team and insights 201, and the 2 checks over every page), 325 measured states, the lowest readable text 4.63:1 (the frame's light page; on the new pages 4.64:1, Templates), the lowest on a disabled control 3.11:1, 24 error sentences from the routes (13 different), 0 requests off the machine, 0 uncaught exceptions, about 4.5 minutes. The people part's pictures of the Tasks insights page are `tasks-insights-*`, since the templates part's pictures of `/dev/admin/insights` are `insights-*`. On 2026-10-21 on `night/admin2` after the review's fix round (a dev server on port 3411 with no `.env.local`), every part with the round's checks added (the dash part's plain words for a failed read with the database's text behind Details, and a `review` part: every rebuilt page's title line 44px tall and in one place with its action from loading through a failed read to loaded, the tabs of the 30% page and Tasks kept with no counts while loading, the 30% tabs on one line at 390, 375 and 360px wide): `PASS 1712   FAIL 0   NOT COVERED 0`, 335 measured states, the lowest readable text 4.63:1 (the frame's light page), 0 requests off the machine, 0 uncaught exceptions, about 8 minutes. On 2026-10-21 after the render review's fix round (a dev server on port 3440 with no `.env.local`), every part, with the existing parts' checks moved to the round's rules (the 30% page's coupon row and "Coupon not checked yet", Tasks' Details, the drawer's name part, the folded sync note, Avg progress's 14 days, the program row's order and heights, the template rows found inside `.list-row` now that Show settings has `aria-expanded` too) and a `render` part (178 checks: a failed read in every header, the journey's board in the column at 1100, 1280 and 1440 and scrolling inside itself at 390, the Dashboard's equal gaps and knobless bar, the rows' actions on the right and under the words, every pill row on one line at 390 and 360, a student's numbers and the sync line, the name part on six pages, the folds' triangles and Show settings, the team's own ECOM30 codes unwarned, the course switch and not-found pages dark in every state, and the old admin addresses carrying Next's 404 to the admin's not-found while Not activated is a page): `PASS 1895   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions. The development server and `next start` both answer the old addresses with a 200 status line (the response streams before the page's `notFound()`); the page they carry is the admin's not-found. On 2026-10-22 for T-122's fifth fix round (`night/admin3`; a dev server on port 3520 in the branch's worktree with no `.env.local`, 15:14 to 15:22), every part: `PASS 2034   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions; nothing new in it, the round's cases being proven in `membership-discount.test.mjs`. On 2026-10-22 for T-122's fourth fix round (`night/admin3`; a dev server on port 3520 in the branch's worktree with no `.env.local`, 13:38 to 13:46), every part: `PASS 2034   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions; nothing new in it, the round's cases being proven in `membership-discount.test.mjs`. On 2026-10-22 for T-122's third fix round (`night/admin3`; a dev server on port 3520 in the branch's worktree with no `.env.local`, 11:22 to 11:31), every part: `PASS 2034   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions; nothing new in it, the round's cases being proven in `membership-discount.test.mjs`. On 2026-10-21 for T-122's second fix round (`night/admin3`; a dev server on port 3520 in the branch's worktree with no `.env.local`, 16:04 to 16:13), every part: `PASS 2034   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions; nothing new in it, the round's cases being proven in `membership-discount.test.mjs`. On 2026-10-21 for T-122's fix round (`night/admin3`; a dev server on port 3520 in the branch's worktree with no `.env.local`, 14:43 to 14:52), every part: `PASS 2034   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions; nothing new in it either, the round's cases (a payment naming a code, two course memberships of one user) being proven in `membership-discount.test.mjs`. Before it, on 2026-10-21 for T-122 (`night/admin3`; a dev server on port 3520 in the branch's worktree with no `.env.local`), every part: `PASS 2034   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions; nothing new in it, as the dev page's made-up students all hold a membership id, so the rows the change touches (a payment's id or none on file) are proven in `membership-discount.test.mjs` and `admin-review.test.mjs`. Before it, on 2026-10-21 after the owner's review of the preview (`night/admin3`; a dev server on port 3500 in the branch's worktree with no `.env.local`, 11:41 to 11:50), every part: `PASS 2034   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions. New in it: the dash part's tiles with no source or explanation line, the charts' heights (the trend lines 76px, the Bounty Program's bars 156px) and the Bounty Program's arrow against the count in its title, in the kit's green or red; the thirty part's Approve anyway for an admin (the dev page's default role) on every refused row, the coupon's too (sent with `override` and `overrideCoupon`), after the approve route's 409 (`?approve=coursechanged`, the refusal kept on the row), none for a csm (`?role=csm`), each confirm's words, and no sentence above the list when the coupons cannot be read; the people part's All students from 1 October with the pills Active 7, Payment failed 1 and Ended 2, and the journey's short cards; and in the render part the journey's board 48px from each side of the window at 1100, 1280 and 1440, and the longest name breaking only between its parts at 390, 1280 and 1440, the day under it. Before it, on 2026-10-21 after the $97 plans came back to All students and the journey (a dev server on port 3470 in the branch's worktree with no `.env.local`, 10:11 to 10:19), every part: `PASS 1962   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions. New in it: the people part's All students and journey each list Omar (the hidden $97 plan) and neither Yusuf (a yearly plan) nor Clara (an ETfB owner's plan), both paid since the launch, and each header's line reads who is listed in its own words. Before it, on 2026-10-21 after the render review's second round (a dev server on port 3450 in the branch's worktree with no `.env.local`, 05:43 to 05:51), every part: `PASS 1960   FAIL 0   NOT COVERED 0`, 0 requests off the machine, 0 uncaught exceptions. New in it: the thirty part's Check Whop again with each of its answers (the code still there; gone, with Approve back and going through, `?state=stalecoupon`; Whop down, `?whop=down`) and a coupon row's Reject starting with the map's sentence, changed by the team before it is sent; the dash part's header saying "Couldn't load" when every read failed (and keeping its time with tiles drawn) and Avg progress's 2 readings as 6px dots with the line showing between them at 390, 1280 and 1440; and in the render part (202 checks) Outreach insights' 5 numbers in the primary ink, a username longer than its journey card cut with an ellipsis at 1280 and 1440, no underline on a name with no student behind it, and the warning dot on each failed block of a student's page and of the drawer. On 2026-10-21 on `night/preview-2026-10-21` (`night/admin2` with `night/map-night` and then `night/login1-main` merged; a dev server on port 3460 with no `.env.local`), every part: `PASS 1960   FAIL 0   NOT COVERED 0`, the count the render review's second round left, with the route suite inside it at `PASS 73   FAIL 0`, 0 requests off the machine and 0 uncaught exceptions. On 2026-10-22 on `night/action-done` (a dev server on port 3510 with no `.env.local`), every part: `PASS 2046   FAIL 0   NOT COVERED 0`, the 12 new checks in the people part being the journey drawer's action items for the made-up Maximilian at 1440x900 and 390x844: a6l03, one of the four with nothing to post, says "Done" with no link, four others "Handed in" with their post's link, three "Not yet". Later that day, after the adversarial check's fix round (the Whop writers give the four their action half; no admin page changed), every part again: `PASS 2046   FAIL 0   NOT COVERED 0`. Later that day, with three of Static Ads on the Done-only list (no admin page or dev fixture changed: the made-up course's action items are the `aXl03` lessons, and of them only `a6l03` is on the list), every part again: `PASS 2046   FAIL 0   NOT COVERED 0`. It proves nothing about real data, a real login or production: the dev pages run on made-up members, and the spot check at `/ship` (`supabase/diagnostics/admin-today-spotcheck.sql`) compares production's numbers with the pages. Pictures in `world-tests/shots/admin/`. |
| Lesson feedback proofs (admin rebuild 2, WI-7) | `node --experimental-strip-types client-tests/lesson-rating.test.mjs` and `client-tests/lesson-feedback.test.mjs` (both in `npm run test:client`); `node world-tests/lesson-rating.mjs`; `node world-tests/admin-pages.mjs --only feedback`; section 32 of `npm run test:migrations` | The two client suites: no. The two browser scripts: yes, any port through `BASE_URL` (no `.env.local`) | `lesson-rating.test.mjs` (74 checks): the rule over every kind of lesson and completion row, the body's limits, and `POST /api/student/rate-lesson` through its handler with the real gate on a stand-in database (who may rate, which lessons, the upsert, every failure in words). `lesson-feedback.test.mjs` (40): the builder's grouping and counts, the loader's floor at the switch, paging past 1000 rows and name batches, every failed read named, and the admin route through the real team check. `student-context.test.mjs` gained 11 checks on `rateLesson` (saved only when the route says so, its refusals as they are, and a read from before a save never taking it back). `lesson-rating.mjs` (62 checks, 64 since the review's fix round with Save as the one filled button while the form is open; real GPU, `/dev/world-app`): who gets the block, the keyboard path, Edit and Cancel, the 1000 characters, refused and slow saves, 44px targets and 4.5:1 text on a phone, no request off the machine. `admin-pages.mjs --only feedback` (123): every state of the page at 390, 1280 and 1440 wide. Section 32 of the migration harness (25 checks; it was section 31 on `night/a2-feedback`, and v109 holds 31 since the merge): v110 and its undo with a student's session for real (the hole before, closed after, the server and the team still working, its lock, its refusals, a second run, the undo exact). On 2026-10-20 on `night/admin2` with the 5 lanes merged (a dev server on port 3409 with no `.env.local`): its 3 suites (`lesson-rating` 74, `lesson-feedback` 40, `student-context` 60) among the client tests' 3289 checks, 0 failed; `lesson-rating.mjs` `PASS 62   FAIL 0`; the feedback part 121 of `admin-pages.mjs`'s 1587, 0 failed; section 32 in the harness's `PASS 702   FAIL 0`. |

The twenty browser scripts (`v6-ui.mjs`, `v6-app.mjs`, `v6-course.mjs`,
`v6-discount.mjs`, `v6-hud.mjs`, `v6-playbook.mjs`, `v6-celebrations.mjs`,
`v6-stars.mjs`, `v6-gates.mjs`, `v6-night.mjs`, `v6-night-posters.mjs`, `v6-bounty.mjs`,
`v6-review-shots.mjs`, `v6-perf.mjs`, `v6-perf-ab.mjs`, `v6-lowend.mjs`,
`lesson-player-sim.mjs`, `tella-watch.mjs`, `lesson-rating.mjs`, `admin-pages.mjs`) need
`npm install` once in `world-tests/` (`puppeteer-core`) and Google Chrome
installed at its default macOS path. For the seventeen map and lesson scripts that need
the dev server, start it with `PORT=3111 npm run dev`; `admin-pages.mjs`
opens its own on port 3226 (`PORT=3226 npx next dev`). `BASE_URL`
overrides the address either kind opens. Screenshots land in
`world-tests/shots/`, which git ignores (the Tella proof's under
`world-tests/shots/tella/`, the course proof's under
`world-tests/shots/v6/course/`, the admin pages' under
`world-tests/shots/admin/`).

`world-tests/` also holds the render and measurement scripts used
while the map was built (`v2-*` to `v6-*`). `world-tests/README.md`
explains the folder and its two traps.

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
- [.impeccable.md](.impeccable.md): the student-side design source of
  truth (the world, tokens, type, the progress interface).
- [world_art_bible_v6.md](world_art_bible_v6.md): how each of the
  eight places is built, and the map's frame budgets.
- [world_overnight_log.md](world_overnight_log.md): the numbered
  record of every decision taken while the map was built.

## How to do common things

| Want to | Read |
|---------|------|
| Add a new lesson | `supabase/migrations/2026_v20_canonical_lesson_state.sql` for canonical shape, then write a new migration |
| Add a new CSM trigger metric | `src/lib/csm-triggers.ts` (`METRICS` registry + `evalCondition`) + type union in `src/types/database.ts` |
| Add a new student-state field | First check CLAUDE.md "table-level bounded contexts" — it probably belongs in its own table, not on `students` |
| Touch the map's camera | `src/components/mockup/MapMockup.tsx` (`transformRef` + `applyTransform`) |
| Change what the world map shows for a student | `src/lib/world/map-model.ts` (the rules) and `src/components/world-v6/source.ts` (the map's input). `system_contracts.md` has both shapes. |
| Change where a place is, its landmark word or the camera's route | `src/lib/world-v6/layout.ts`, then the offline v6 map tests |
| Change the rebuilt course (a title, the order, an action item, the gate) | `supabase/catalog/course_catalog.json`, then `npm run build:catalog`, which writes v101 and its undo again. The staging catalog entry under Database says what v101 refuses |
| Put a video on a lesson | The `lesson_videos` entry under Database. For a course lesson: the video load, whose filled copy the Tella tool writes outside this repository, sets the row and the length together. For any other lesson: a row by hand in the SQL editor, and `lessons.duration_seconds` with it. Either way, "Lesson videos on Tella: the rules" before the id goes anywhere |
| Replace a lesson video whose id leaked | Rule 3 of "Lesson videos on Tella: the rules" |
| Take migration v100 back | `supabase/undo/2026_v100_undo.sql`, and its entry under Database first |
| Take migration v101 back | `supabase/undo/2026_v101_undo.sql`, and its entry under Database first |
| Switch every student to the new course | [The course switch](#the-course-switch-cutover), then the ship order at the end of section 12 of `../_admin/prds/cutover/cutover_prd.md`, step by step. Never v104 without the preflight read and WI-8 merged |
| Take the course switch back | `supabase/undo/2026_v104_undo.sql` (its entry under Database), then the Vercel values back and a redeploy ("Rollback" in The course switch) |
| Take the tasks reset back | `supabase/undo/2026_v109_undo.sql` (its entry under Database first) |
| See what the running build and the database hold for the switch | `/admin/cutover` (founder or admin) |
| Tell in code which course is live | `getCurriculumResetAt()` in `src/lib/curriculum-reset.ts` for code that judges history or reads `lessons` by name; `CATALOG_IS_V2` for code that reads the active catalog. Never mix the two |
| Add a new DM template | `/admin/templates` (UI, not migration) |
| Run a one-off DB change | New migration in `supabase/migrations/`, idempotent |
| Update CONTEXT.md | When you add/rename/delete a route, table, context, or lib module |
| Update system_contracts.md | When you add a table, or change which fields outside callers depend on |
