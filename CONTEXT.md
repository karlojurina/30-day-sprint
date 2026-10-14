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
> map of the rebuilt eight-area course. It sits behind a closed
> allowlist (`src/lib/world/access.ts`). A student who is not on the
> list is sent to `/dashboard`, and an unset list admits nobody.
> `/dashboard` stays the default student home.
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
2026-10-12, and for the course catalog on 2026-10-13:

- **Application.** No browser smoke goes through the real login, and no
  disposable identity exists. No invariant runs against live data.
  What exists is narrower. `node world-tests/v6-app.mjs` walks the
  `/world` screens in a real browser on a login-free development
  harness with a pretend student, so it proves those screens and
  nothing about login, the server or `/dashboard`.
  `node world-tests/v6-course.mjs` walks the same harness with the real
  course in place of the generated one, and proves no more than that.
  `npm run test:client` covers the world's pure modules. The lesson
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
- **Service.** `npm run test:migrations` runs migrations v92 to v101 on
  a local Postgres, among them the heartbeat function, the snapshot
  rebuild, v100's undo, the morning kit, the course catalog (v101) with
  its generator and its undo, and the video load. No test covers a
  webhook handler, and one cron route has a test:
  `node world-tests/lock-check-sim.mjs` runs the lock check's real
  route file against stand-ins for the database, Tella, Discord and the
  clock. Nothing runs any test automatically on a change (the repo has
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
  rebuilt course, for allowlisted students only.
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
  never downloads it.
- **Tella**: lesson video for `/world`, played as an embed in an iframe
  on `https://www.tella.tv`. Until 2026-10-12 this branch played it
  through Bunny Stream, which no code uses now.
- **Vercel** — hosting + cron jobs + Analytics

## Student Surfaces

| Path | What it is |
|------|------------|
| `/login` | Whop OAuth entry |
| `/auth/callback` + `/auth/complete` | OAuth callback + post-auth landing |
| `/dashboard` | The map (overview + 4 regions). Auto-redirects to `/dashboard/playbook` once the student has completed `PLAYBOOK_UNLOCK_LESSON_ID` (l078, the last R4 watch lesson) unless `?map=1` is passed. |
| `/dashboard/playbook` | Map 2 hub. Two unlock paths (v75.16, see `isPlaybookUnlocked` in `src/lib/progress.ts`): standard sprint completion of l078 ("How I Approach Research / Coming Up With Ad Ideas"), OR legacy auto-unlock (`joined_at >= 30 days ago` AND completion ratio >= 0.80) — for older customers who passed the action-item phase before our platform existed. Bounty Access (`bounty_access_claimed_at`) is a SEPARATE milestone and does NOT unlock the Playbook. |
| `/world` | Branch `world-engine`, allowlisted students only. The world map. The layout (`src/app/world/layout.tsx`) wraps the same `StudentGuard`, `StudentProvider` and `MembershipBlockOverlay` as the dashboard, plus `WorldAccessGate` (the allowlist) and `WorldStage`. `WorldStage` mounts the map host `WorldMap` once, so the map stays mounted while the address moves between the three routes. The page itself renders nothing. `WorldMap` shows the v6 map (`WorldV6`) with the student's own areas, lesson titles and finished lessons once the catalog has loaded and has exactly eight areas. In every other state it shows one plain card and loads no 3D: loading, "Your course didn't load.", "There are no lessons here yet.", or "The new course isn't switched on here yet." Under 760 px wide, or when the 3D fails to start, the same component shows a list view; on a machine that cannot draw the 3D it shows still posters from `public/world-v6/posters/`. |
| `/world/[areaId]` | A place's own address. The route (`PlaceRoute`) renders nothing for an area the catalog has: `WorldStage` reads the same address and the map opens that place's panel. For an unknown area it shows "That place isn't on the map." with a link back. Opening or closing a place inside the map changes the address without moving the page scroll, because the page scroll is the map's camera. |
| `/world/[areaId]/[lessonId]` | The lesson page (`LessonScreen`), drawn over the paused map: a back link to the place, an eyebrow (the area's number, the lesson's position in the area, the minutes when the catalog has them), the lesson title, then for a `watch` lesson with a video the player (`LessonPlayer`: Tella's frame, the app's own progress line under it, and under that up to three lines of text: when the video has not loaded, when the video played to its end and the server still does not see the lesson's 95% point, and when the lesson was not counted because too little of it was played), the Milestone box when the lesson has an action item, the lesson's text (its `description`, drawn by `LessonText` from `src/lib/world/lesson-text.ts`: paragraphs, bullet and numbered lists, bold and https links, no HTML) when it has one, and a Next lesson link that is enabled once the lesson is in `completedLessonIds`. A lesson with no video (a `setup` lesson, or a `watch` lesson whose `has_video` is false) gets no player and no video-sized box: the Milestone box, then the text in the video's place; with no text either, a `watch` lesson says "Not recorded yet." on one short line and a `setup` lesson says nothing (2026-10-14). That is decided from the catalog before any request, and once the player is up for a lesson it stays up for it. Escape returns to the place. An unknown area or lesson shows "That lesson isn't here." An action item (`requires_action`) ends with its hand-in (`ActionItemBlock`, 2026-10-14): a field for the Discord message link, Save, then a complete button, the link shown and editable once saved, "Completed on <date>." once done. The link rules, and which halves the button writes, are `src/lib/world/action-items.ts`, shared with the old dashboard's form and both routes. A setup action item is finished by the button alone; one with a video needs the button and the video, in either order. |

**Development-only pages for the world** (both return `notFound()`
outside `NODE_ENV === "development"`):

| Path | What it is for |
|------|----------------|
| `/dev/world-v6` | The v6 map alone, on fixture data, with the TUNE panel (lock mode, where the pretend student is, the scroll length of every stretch). No `StudentProvider` and no request to `/api/*`. `node world-tests/v6-ui.mjs checks` drives this page. |
| `/dev/world-app` | The three `/world` routes with a pretend student and no login: the same `WorldStage`, `WorldMap`, `PlaceRoute` and `LessonScreen`, with `FixtureStudentProvider` in place of the auth guard, `StudentProvider` and the access gate. Presets by query string (`?p=p0`, `mid`, `last`, `ooo`, `all`; `?catalog=loading`, `error`, `empty`, `shape`, `course`). With no `DEV_TELLA_*` value set it makes no network request. With them set (see "The world's own settings"), three of its lessons carry a video: two play the two Tella test videos in Tella's real frame and the third points at the id `vid_doesnotexist0000000000`, which no video has. A stand-in for the server (`fixtureTransport.ts`) answers the player's three calls, so the page still makes no request to `/api/student/*`. It answers at once; `?latency=<ms>` (0 to 5000, default 0, any mode, 2026-10-14) makes it give a lesson's address that many ms after it is asked, as the real route would. `node world-tests/v6-app.mjs` and `node world-tests/tella-watch.mjs` drive this page. The mode `?catalog=course` (2026-10-13) draws the real course in place of the generated one: `courseCatalog.ts` builds the rows from the data file `supabase/catalog/course_catalog.json`, and the lengths and which lessons have a video come from `src/app/dev/world-app/course-lengths.fixture.json` (115 lengths, no video id). Its presets are `p0`, `mid` (areas 1 to 3 and `a4l01` to `a4l09`) and `all`; any other name is `p0`. Course mode has no lesson text unless `?text=sample` puts the made-up text of `course-sample-text.fixture.json` on `a5l22` and `a5l08`, or, without it, `DEV_COURSE_TEXT_FILE` names a private file whose texts go on the lessons whose title matches (2026-10-14). With the `DEV_TELLA_*` values set, every course lesson that has a video plays test video 1 there, and the stand-in judges it against that clip's length, while cards and panels keep the course's real minutes. The default catalog is unchanged. `node world-tests/v6-course.mjs` drives this mode. |

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
`StudentContext.tsx:695` calls `setStudent(fresh.student)` with a fresh
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
| `/admin/etfb` | **Brand Owners (v87).** Every ETfB brand owner, their subscription state and cycle-end date, the free team link minted for them, and who redeemed it. When an owner stops paying their seats surface in a review list. Mints links via `POST /api/v2/plans`, so `owner ↔ link` is a real column, not a parsed label. TEAM-WIDE (`requireTeam`, no role list) — Astrid is `csm` and the founder/admin pattern would lock her out. Everything is read LIVE from Whop; nothing about owners or seats is cached. No revoke button in v1 by design — Lovro confirmed 2026-09-14 that removal stays in Whop permanently, so the page's product is a *confirmed list*, not an action queue. Redesigned 2026-09-14 against `system-docs/design_brief_2026-09-14_etfb-page.md` (read it before changing this page): trust banner gates every action, no accordion, attribution evidence is the content. |
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
- `POST /api/student/toggle-lesson`: tick or untick a completion on the
  student's own say-so, for lessons that are not `watch` lessons. Since
  v93 it answers 400 ("Watch lessons complete themselves.") when the
  lesson's `type` in the live `lessons` table is `watch`. If that lookup
  errors it lets the request through.
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
- `POST /api/student/mark-action-shipped` — toggle `action_completed_at`; reads the lesson from the active catalog, and on the v2 catalog an action item with no video half (a setup lesson) gets `completed_at` too (`src/lib/world/action-items.ts`, `actionWrite`). A foreign key failure (a new-course lesson before the cutover) answers 409 with plain words
- `POST /api/student/skip-lesson` — mark optional lesson skipped
- `POST /api/student/save-action-link` — Discord submission URL, checked by `checkDiscordLink` (`src/lib/world/action-items.ts`); reads the lesson from the active catalog; a foreign key failure answers 409 with plain words
- `POST /api/student/submit-quiz` — quiz attempt
- `POST /api/student/dismiss-playbook-welcome` — Map 2 intro (v2)
- `POST /api/student/celebration-seen` — dismiss celebration overlays
- `POST /api/student/complete-onboarding` — finish first-time onboarding
- `POST /api/student/mark-dashboard-login` — stamp first /dashboard load (v51)
- `POST /api/student/mark-intro-video-threshold` — intro video watched end-to-end (v51; v72.5/72.6 dropped the ~65% threshold for a full-`ended` requirement, column name kept for back-compat)
- `POST /api/student/dismiss-why-youre-here` — final WYH card dismissed (v51)
- `POST /api/student/submit-region-quiz` — region-quiz attempt (v65). One round-trip per completed attempt: updates last/best score, increments attempts, stamps `quiz_passed_at` on first attempt at ≥ 50%. Replaces v54's mark-region-quiz-passed + increment-region-quiz-attempts split.
- `POST /api/student/refresh-watch-sync` — force a Whop watch-history pull
- `GET  /api/student/data` — full snapshot for the dashboard and for
  `/world`. It reads the catalog through the switch in
  `src/lib/catalog-tables.ts` and returns `watchProgress` (the
  student's `student_lesson_watch` rows) and `catalogSuffix` with it.
  Since 2026-10-12 every lesson it returns carries `has_video`: true
  when the lesson has a row in `lesson_videos`. It never returns a
  video id. This route has no membership check, so an id in its payload
  would reach every account that is signed in, lapsed members included.
  When the `lesson_videos` read fails, as it will on a database v100
  has not been applied to, it logs one error per request and every
  lesson gets `has_video: false`.

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
- `GET /api/admin/etfb` (v87) — the Brand Owners snapshot. Team-wide
  (`requireTeam`, no role whitelist). Reads Whop live: ETfB + Apex plans and
  memberships, joined to `etfb_team_links`. Every section is a discriminated
  union — a failed Whop read returns `state:"error"`, **never an empty list**,
  because an empty list reads as "nothing to do". `no-store` + `Vary:
  Authorization`, `maxDuration = 30`.
- `POST /api/admin/etfb/links` (v87) — mint a 10-seat team link. **Idempotent:**
  returns the owner's existing active link and calls Whop zero times if one
  exists. Refuses to mint for anyone without a valid paid ETfB membership.
- `POST /api/admin/etfb/links/[planId]/owner` (v87) — assign or confirm a link's
  owner. A 23505 (the one-active-link-per-owner index) surfaces as a 409.
- `POST /api/admin/etfb/seats/[membershipId]/decision` (v87) — per-seat `keep` /
  `snoozed`, or `null` to clear. Never revokes; that is done by a human in Whop.
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
player) is on the same branch and has not been run on production. v101
(2026-10-13, the real course in the staging catalog) is on the same
branch and has not been run on production either. The files that take
the two back are described at the end of this section. The header of
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
    anything other than `'active'` and never asks Whop.
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
- `regions` — R1–R4 metadata
- `lessons` — canonical lesson list (id, region, day, sort_order,
  watch vs action, `whop_lesson_id`, etc.)
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
  Video Ads II) is the discount gate since 2026-10-14. Nine lessons are
  action items (`requires_action` with a brief): `a3l25`, `a5l08`,
  `a5l12`, `a5l22`, `a5l23`, `a6l03`, `a6l10`, `a6l17` and `a6l19`.
  Five of them have no video and are `type` `setup`: `a5l22`, `a6l03`,
  `a6l10`, `a6l17` and `a6l19`. Nothing under `/world` can complete an
  action item or a `setup` lesson yet (Student Surfaces).

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

  **v101 has not been run on production (2026-10-13), and neither has
  v100.** Until it is, production's `lessons_next` holds v94's
  placeholder seed: the same 8 area ids under the names Introduction,
  Fundamentals, Video Ads I, Video Ads II, Static Ads, AI Ads &
  Content, Creative Strategy and Job Board, and 145 placeholder lessons
  (`a1l01` to `a8l14`), 144 of which count toward progress, with
  `a7l22` as the Ad Bounty row, `a5l25` as the discount gate and nine
  placeholder action items. Production rows were not read for this
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
  into `REGIONS_TABLE` and `LESSONS_TABLE`. Three routes read the
  catalog through those names: `GET /api/student/data`,
  `POST /api/student/lesson-video` and `POST /api/student/lesson-watched`.
  Everything else (the crons, the admin pages, the achievements code,
  the discount routes, `toggle-lesson`) reads `lessons` and `regions`
  by name. The lock check reads `type` and `duration_seconds` from both
  `lessons` and `lessons_next`, each by name. `StudentContext` gets its
  catalog only from `/api/student/data`, so a deployment with the
  suffix set serves the
  staging catalog to `/dashboard` as well as to `/world`. A second env
  var, `CATALOG_SHAPE` (empty, `v1` or `v2`), says whether the catalog
  has the v2 shape (no `day`, one `sort_order` for the whole course).
  The staging tables always count as v2, and the data route picks its
  ordering from that.

  **A staging lesson cannot be completed.**
  `student_lesson_completions.lesson_id` references `lessons(id)`, and
  the `record_lesson_heartbeat` function accepts only a lesson that
  exists in `lessons` as a `watch` lesson with a video. A lesson that
  exists only in `lessons_next` can be listed and opened, and nothing
  can mark it done. A `lesson_videos` row for such a lesson changes
  none of that: with the switch on `_next` the video would play, every
  heartbeat would be refused, and nothing would be recorded.
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
    sets `description` on the listed course lessons (the 9 action items
    today) and empties it on the others. v101 no longer writes
    `description`, so running it again keeps the texts. The lesson page
    shows the text under the video, or in the video's place when the
    lesson has none (`src/lib/world/lesson-text.ts`, `LessonText.tsx`).
    Not pasted on production yet. The texts stay out of the repository
    because they carry links to course assets.
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
    or an editor grant arrive. The lock check judges every row by the
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
    table may hold ids from both `lessons` and `lessons_next`.
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
    `src/lib/constants.ts`. It still appears as an editable row on
    `/admin/settings`, where changing it changes nothing.

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
- `student_quiz_attempts` — quiz attempts
- `student_rewards` + `hidden_rewards` — surprise reward system
- `month_reviews` — month-end student review
- `discount_requests` + `discount_feedback_questions` +
  `discount_feedback_responses` — discount flow
  - v95 added `discount_requests.gate_lesson_id` (text, no foreign
    key): the lesson that was the discount gate when the request was
    decided. No code reads or writes it yet.
- `disengagement_alerts` — auto-generated churn alerts
- `tasks` — CSM task queue (per-student, per-scenario, links to
  `templates`). v85 added `outcome` (replied/no_reply/NULL, manual CSM
  tap on the Sent tab) + `outcome_at` + `outcome_by` — Phase 0 of the
  retention overhaul's feedback loop.
- `daily_progress_snapshots` — one aggregate row per DAY (PK `snapshot_date`), not per student. Written solely by the `rebuild_daily_snapshots` RPC since v89; values are point-in-time, derived from `first_paid_at` / `canceled_at`. v77 added cohort columns (`active_count_cohort`, `joined_count_cohort`, `churned_count_cohort`, `avg_progress_cohort`). After v75.51 (scope toggle removed), only the `_cohort` columns are read by the UI; the legacy non-cohort columns are still written for historical continuity. v89 made every past day point-in-time (was: recomputed from each student's CURRENT membership_status, which made the active line monotone and unable to show churn), bounded the rebuild with `p_end_date`, and made the RPC the SOLE writer — the snapshot cron now calls it instead of upserting its own values, so there is one definition of 'active'. `canceling_snapshots` remains the cron's, and the RPC cannot see it. v81 aligned the cron + RPC + dashboard avg_progress formula on the canonical isLessonComplete + l057 exclusion (single source of truth). v92 added the column `total_lessons`: the number of lessons with `counts_toward_progress` that `avg_progress` was divided by on that date (null on rows written before v92), and the RPC now decides "done" through the shared SQL function `lesson_is_complete`. v96 made the RPC executable by `service_role` only and made it raise when asked to start more than 30 days back.
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
- `etfb_team_links` (v87) — one row per free team-seat checkout link (a Whop
  plan under the Apex product), recording which BRAND OWNER it was minted for.
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
- `etfb_seat_decisions` (v87) — a human override on ONE seat (`keep` /
  `snoozed`). PER-SEAT, never per-link. `revoked` is declared but never written
  by v1.
- `cron_runs` (v82) — audit log for the invocations of ALL seven cron routes. Captures route_name, started_at, finished_at, auth_status, status (running/success/failed/auth_failed), error_message, rows_affected. Written by every cron handler via `src/lib/cron-auth.ts`. Use to answer "did Vercel fire this cron in the last 24h?" — separable from sync_runs which only covers sync-whop.
- `achievements` — catalog of 16 unlockable achievements (v53 seeded
  17; v56 deleted `streak_30`; `src/lib/achievements.ts` holds 16 rules)
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
  v101 can be run again after it.

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

## Cron Jobs (Vercel)

| Job | Cadence | What it does |
|-----|---------|-------------|
| `sync-whop` | every 2h at :00 (v85.5, was daily) | Pull Whop watch history → `student_lesson_completions`. Also stamps `students.cancel_scheduled_at` from Whop's `cancel_at_period_end` field (v75.46). 2h cadence exists FOR the cancel flag: cancel click → save task within ~2h15m instead of up to 24h. **v85.6:** a user holding several memberships is deduped by ACCESS first, `created_at` recency only as a tiebreak within the same access class (`grantsAccess` in `src/lib/whop-members.ts`). Was recency-only, which let a dead duplicate outrank a live membership and hard-block a paid student on every run. |
| `snapshot-progress` | daily 00:30 UTC (deliberately NOT 2h) | Writes yesterday+today rows to `daily_progress_snapshots` + the daily Canceling count to `canceling_snapshots` (v76). Daily-grain by design — one row per day. Reads canonical `student_progress_counts` view (v75.28) so dashboard live values match snapshot trend values. |
| `check-engagement` | every 2h at :10 (v85.5) | Detect churn signals → `disengagement_alerts` |
| `check-csm-tasks` | every 2h at :15 (v85.5) | Evaluate `templates.trigger_config` → `tasks`. Includes auto-dismiss for orphan tasks (v75.19). v85.1: 3c also dismisses any non-canceling-aware open task for a canceling student ("save-the-sale flow owns this student"). |
| `check-na-tasks` | every 2h at :20 (v85.5) | Not-Activated escalation (Day 3/5/7/10) |
| `day28-dm` | NO cron trigger (removed pre-v85; route retained) | Day-28 Discord DM route still exists for manual/preview fire, but nothing schedules it — the platform currently sends zero automated student DMs. |
| `check-lesson-videos` | NO cron trigger (built 2026-10-12; it has never run for real) | The lesson video lock check. It reads every row of `lesson_videos`, longest unchecked first, and asks Tella's API for each video's settings: one request per video, each started at least 700 ms after the one before, each given up after 10 s. It judges the answer with `judgeLock` against `TELLA_EMBED_DOMAINS` and against the catalog (the lesson's `duration_seconds`, and whether a `watch` lesson with that id exists at all). It writes `lock_status`, `lock_detail` and `lock_checked_at` on the row, and only on a row that still holds the video it asked about. It stops asking 270 s after it started, 30 s before Vercel would kill the function, and reports what it has: the videos it did not get to are counted as `notReached` and are the first ones asked about on the next run. It posts one message to the team's Discord channel (`postTeamAlert`) when any lesson has a problem, and also when the run was partial: videos not reached, or a catalog table it could not read. Such a run ends as `failed` in `cron_runs`, with a message saying what was left. It trusts nothing it stored: every run asks Tella about every video again. A video Tella could not be asked about becomes `error` and the run carries on. It answers 500 "Lock check not configured" when `TELLA_API_KEY` or `TELLA_EMBED_DOMAINS` is missing. It runs only when someone calls it with the cron secret. Two things would switch it on, and both wait for Lovro's decision: a line for it in `vercel.json`, and both values set on the deployment that runs it (the PRD's ship order puts `TELLA_EMBED_DOMAINS` on Production). How many videos fit in one run is arithmetic from the route's header and was never measured on Vercel. The header reckons with 145 videos, the size of v94's placeholder course; the real course has 141 lessons and 115 of them have a video in Tella (2026-10-13), so a full load is fewer rows than that. At 0.7 s a video, the pace the spacing allows, 145 take about 100 s and about 385 fit. At about 1.4 s a video (two requests timed from a laptop at 0.9 s and 1.5 s, the write assumed at 0.2 s) they take about 3 min 25 s and about 190 fit. On a day when every request runs into its 10 s limit, 27 are asked and the rest are reported as not reached. 145 fit as long as Tella answers in about 1.6 s or less on average. `node world-tests/lock-check-sim.mjs` runs the route's own logic against stand-ins (see Testing). |

v85.5 chain each 2h cycle: sync :00 (fresh cancel flags + completions,
worst case done ~:05) → engagement :10 (alerts) → csm-tasks :15 →
na-tasks :20. Offsets are load-bearing — csm-tasks needs the sync's
cancel flags and engagement's alerts from the SAME cycle.

Schedules live in `vercel.json`. All seven routes use the shared `verifyCronAuth` helper from `src/lib/cron-auth.ts` (v75.37) which trims whitespace from CRON_SECRET (defense against env-var-drift silent 401s) and writes audit rows to the `cron_runs` table on every invocation. Use `cron_runs` to answer "did Vercel fire this cron in the last N hours?" — separable from "did the work succeed?".

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
| `etfb.ts` (v87) | ETfB Brand Owners: live Whop reads, team-link minting, and the pure derivations behind `/admin/etfb`. **Deliberately shares no pagination code with `whop-members.ts`** — that module's `per_page` defect truncates at ~5,000 of 8,192 rows, and coupling to it would inherit the bug. Uses `per=` (max 50) and THROWS on all three silent Whop traps: an ignored filter (checked both row-level and against a **live-read** account total, never a hardcoded one — the total moved 8188→8192 within a day), stalled pagination, and page-cap truncation. Also `buildInternalNote()` / `parseInternalNote()`, the `ETFB \| name \| username \| user_id \| plan_id` label written onto every minted plan as a human-readable mirror of the DB row, and `fetchOwnerIdentity()` which supplies the two label fields — `/api/v2/members/{userId}` is the only Whop endpoint carrying an owner's `name` and `username`, since memberships carry neither. |
| `admin/metrics-definitions.ts` | Canonical predicates for admin metrics: `isActiveMember` (active + past_due), `isPayingMember` (active member on a `PAYING_WHOP_PLAN_IDS` plan), `isInLaunchCohort` (first_paid_at >= cutoff, NO joined_at fallback post-v75.28), `isMonth2Converted` (cohort student who reached day 30 and didn't cancel before then, v75.38/v75.42), `isInMonth2Cohort` (denominator companion), `isCanceling` (cancel_scheduled_at set + still active, v75.47). Scope-toggle helpers deleted in v75.51. |
| `supabase-pagination.ts` (v75.27) | `fetchAllRowsPaginated(thunk)` — calls `.range(0,999)`, `.range(1000,1999)`, etc. until a page returns less than 1000 rows. Bypasses PostgREST's silent server-side max-rows cap. Returns empty data on error (not partial) so silent truncation can't sneak through. EVERY bulk fetch on admin surfaces should use this. |
| `cron-auth.ts` (v75.37) | `verifyCronAuth(request)` + `logCronStart`/`logCronFinish` — shared auth check (whitespace-trimmed against drift) + audit-log writes to `cron_runs`. All 7 cron handlers use this; replaces the per-route inline `Bearer ${process.env.CRON_SECRET}` check. |
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
| `catalog-tables.ts` | Which catalog the app reads. `CATALOG_TABLE_SUFFIX` becomes `REGIONS_TABLE` and `LESSONS_TABLE`; `CATALOG_SHAPE` becomes `CATALOG_IS_V2`. It throws when the module loads on any value outside the allowed ones, because a wrong table name would return an empty catalog with no error anywhere. |
| `complete-lesson.ts` | `stampWatchCompletion()` stamps the watch half of a completion and is safe to call twice. `afterCompletionWrite()` runs what follows a completion, in order: streak, CSM reactivation, achievements, open-task re-evaluation, each best-effort. Only `POST /api/student/lesson-watched` calls them; `toggle-lesson` still carries its own copy of the same four calls. |
| `world/access.ts` | Who may see `/world`. `canSeeWorld(studentId)` is true when `NEXT_PUBLIC_WORLD_LIVE` is `true` or the id is in `NEXT_PUBLIC_WORLD_PREVIEW_IDS`; an unset list admits nobody. Also `STUDENT_HOME` (`NEXT_PUBLIC_STUDENT_HOME`, default `/dashboard`) and `WORLD_LOCK_MODE` (`"open"`). It is a convenience gate in the browser; video addresses and completions are guarded on the server. |
| `world/tella.ts` | The small facts about Tella that both sides share, with no imports. `TELLA_ORIGIN` (`https://www.tella.tv`, the only origin the player listens to and posts to), `WATCH_SPEED_CAP` (2.5, the same number as `v_speed_cap` in the SQL function), `isTellaVideoId()` (the pattern of the table's check constraint) and `tellaEmbedUrl(id)`, which builds `https://www.tella.tv/video/{id}/embed?title=0&b=0&wt=0&a=0&o=1` and throws on a malformed id without repeating it. The five switches hide the creator's name and Tella's own links; the reactions row stays. |
| `world/tella-lock.ts` | Pure. `judgeLock(facts, expectedDomains, catalogDurationSeconds, catalogLesson)` decides whether a video is still locked and says why in plain sentences. `missing` when Tella has no such video. `open` when access is anything but "Embed only", when there is no domain list, when a site on the list is not an expected one (`localhost` included), or when downloads are on. `locked` otherwise. Four findings add a sentence and leave the status alone. Two are about the video: an expected site missing from the list, and a length more than 2 s away from the catalog's. Two are about the catalog, added on 2026-10-12 because either makes a lesson impossible to finish: a `watch` lesson with no length ("The catalog has no length for this lesson, so it can never be counted.") and a row whose id no `watch` lesson has ("No watch lesson has this id."). The catalog rules run whatever Tella answered, a 404 included. The fourth argument says what the catalog knows about the lesson: `"watch"` (the default), `"none"`, or `"unread"` when a catalog table could not be read, and then nothing is said about the catalog. `watchLessonSeconds(tables)` builds the length of every `watch` lesson by id from the catalog rows it is handed; a later table wins an id two tables share, so the caller passes the live table last. |
| `world/tella-api.ts` | Server only. `fetchTellaVideoFacts(videoId, apiKey)` makes the one read the lock check needs, `GET https://api.tella.com/v1/videos/{id}`. One request, reading the answer included, is given up after 10 s. It returns null on a 404, throws on any other answer that is not a 200, and throws on a 200 that has no settings or no download switches, so an answer nobody could read never comes out as "locked". A missing access level or domain list is handed on, and `judgeLock` reports it as `open`. A timeout, a failure to reach Tella and an answer that is not JSON each throw a sentence written in this file; an error from the network layer is never passed on in its own words. Nothing it throws names the video or the key. The key can read every video in the workspace and change the ones uploaded from its own login (measured 2026-10-13: a change to another member's video answers 404). Its only caller in the app is the lock check. |
| `world/tella-player.ts` | Tella's player protocol over `postMessage`, written out with no library. `parseTellaMessage()` is pure and reads the three messages the player sends (`ready`, `playbackState`, `timeUpdate`); a duration of 0 or less counts as no duration, because Tella sends 0 with "stopped". `attachTellaPlayer(iframe, events)` listens on `window`, accepts a message only from that iframe's own window and only from `TELLA_ORIGIN`, and posts the three commands (`play`, `pause`, `seek`) to that origin. A seek asked for before `ready` is sent when `ready` arrives. It replaced `bunny-player.ts`. |
| `world/lesson-transport.ts` | The three calls the lesson player makes, behind one interface (`LessonTransport`): `getEmbed`, `heartbeat` and `claim`. `realLessonTransport` is the one `/world` uses: `POST /api/student/lesson-video` and `POST /api/student/lesson-watched` with the session token, and the real heartbeat call. Neither request throws; a failure comes back as an answer. The interface exists so the development harness can stand in for the server. |
| `world/embed-cache.ts` | Pure. `withEmbedCache(transport)` puts a cache in front of any `LessonTransport` and adds `prefetch(lessonId)`, so a lesson's video address can be asked for before the click. One request per lesson at a time (a second ask gets the same promise); a `ready` answer is kept, 40 lessons at most, the oldest dropped; any other answer, and a request that threw, is not kept; at most 3 prefetches on their way, one beyond that skipped, never queued; `heartbeat` and `claim` pass straight through. A kept address never outlives the right to it: `setAccess(studentId, active)` empties the whole cache, requests on their way included, when the student changes or signs out and when the membership is not active (then nothing is kept or prefetched), and the cache also empties itself when its oldest address is more than 30 minutes old. It starts with no student and keeps nothing until told. `client-tests/embed-cache.test.mjs` proves each rule. |
| `world/useLessonTransport.ts` | The page's one cached transport, shared by the map's host (`WorldMap.tsx`, which prefetches when a place opens, when the card shows the next lesson, and when the pointer or the keyboard reaches a panel row, for lessons with a video) and the lesson page (`LessonScreen.tsx`, whose player reads it, and which prefetches the next lesson of the place once its own video says "ready"). `/world` gets `realLessonTransport` behind the cache; the development harness provides its stand-in server behind the cache through `LessonTransportContext`. Every caller tells the cache who is signed in and whether `membership_status` is `"active"`, read from AuthContext's `student` (the dev harness's pretend student stands in through `LessonAccessContext`), in a layout effect, before anything asks. The host also hands each lesson's route to `router.prefetch` on the same triggers, once per lesson per page; Next skips that in development. Nothing is prefetched while the membership is not active. |
| `world/catalog.ts` | The boundary between the world and the curriculum. `buildWorldCatalog()` turns lessons, regions, the completed ids and the watch rows into a `WorldCatalog`: areas sorted by `order_num`, lessons per area sorted by `sort_order`, progress per area, `hasVideo`, `lessonById`, the gate lesson. It reads only the fields both catalog shapes carry, never `day`. Since 2026-10-12 `hasVideo(id)` reads the `has_video` boolean the data route attaches to each lesson. The catalog holds no video id, and `videoIdFor` is gone. |
| `world/map-model.ts` | Pure. `buildMapModel()` turns the catalog and the completed ids into what the map shows: per area the lessons that count and the "feature" rows that do not, the student's place and next lesson, the totals. It answers `empty` or `shape` for a catalog the eight-place map cannot draw (`MAP_PLACES` is 8). A lesson's `hasVideo` is true for a `watch` lesson whose `has_video` is true. |
| `world/scene.ts` | The first prototype map's three.js scene. Used only by `src/components/world/WorldCanvas.tsx` and the development page `/dev/world`; mounted by nothing a student can reach. |
| `world/useWorldCatalog.ts` | The hook form of `catalog.ts`: reads `StudentContext` and returns the `WorldCatalog` plus `loading` and `loadError`. |
| `world/watch-heartbeat.ts` | `createWatchHeartbeat()` turns the player's position reports (Tella's player sends one every 250 ms while it plays) into one `record_lesson_heartbeat` call per 15 seconds of playback, plus a forced one on pause, end, tab hidden and unmount. It counts played seconds by the clock, as an allowance that carries over. Every report adds 2.5 times the clock seconds since the last one to a budget that never holds more than 5.35 s. A forward step counts when it fits in the budget, and then uses it up. A step that does not fit is a skip: it counts for nothing and leaves the budget as it is. So every speed on Tella's menu counts, a busy page that handles two reports back to back loses nothing, and a skip, which arrives as one large step, counts for nothing. The budget starts at 0.35 s with the first report and after a seek. The first version of the rule judged each gap alone and credited 80.4% of a lesson watched at 1.5x with a 1 s stall every 5 s. It writes nothing until a position has been reported, so a lesson opened and left without playing does not overwrite the stored resume point with 0. A forced beat that fails, or that the 400 ms call gate holds back, is sent again after 2, 5 and 10 s and then given up. Any beat that fails moves the throttle clock, so a database call that keeps failing is tried every 15 s (it was measured at 120 calls a minute). `onResult(result, beat)` tells the caller which beat an answer belongs to: `beat.reason` is `throttle` or the reason handed to `flush`, and `beat.force` says whether it was forced. A forced beat with nothing new to say sends nothing and is answered with the last accepted answer, marked `repeated`. The options `rpc` and `now` let a test or the harness stand in for the database call and the clock; when `rpc` is given it creates no Supabase client. |
| `world/lesson-text.ts` | Pure. `parseLessonText(text)` reads a lesson's `description` into blocks and runs, in the format agreed with the loader: plain text, at most 8000 characters (cut past that), blocks apart by a blank line, a block of "- " lines is a bullet list, a block of "<number>. " lines is a numbered list with its numbers kept, any other block is a paragraph whose single line ends are line breaks; `**bold**` and `[label](https://...)`, where only an https address with a host becomes a link and any other is shown as its label. Windows line ends read as `\n`; an unclosed `**` or a broken link is shown as written. `client-tests/lesson-text.test.mjs` proves every rule. |
| `world/watch-rules.ts` | `judgeWatch()`: the server's rule for "watched". Position at 95% (`WATCH_POSITION_THRESHOLD`, the same number the SQL function holds) and played seconds at or above `WATCH_PLAYED_FLOOR` (an env var of the same name, default 0.8), both measured against the catalog's duration. |
| `world-v6/` | The v6 map's 3D scene, 30 files. `scene.ts` is the scene itself: the camera on its rail, the click-in "park" view, the frame loop, and the calls the interface makes (`setWorldProgress`, `setProgress`, `setLock`, `setPaused`, `park`, `celebrate`). `layout.ts` is pure data: where the eight places are, their landmark words, the camera's route and the scroll budget of every stretch. `progress.ts` holds `WorldProgress`, the one shape the scene needs about a student (lessons per area, lessons done per area, the current area, the next lesson). `poster.ts` is poster mode: still renders of the opening and the eight stops for a machine that cannot draw the 3D. `quality.ts` holds the four quality tiers, picks one from the GPU's name and the canvas size, and proposes a step down when frames run slow. The rest are the camera rail (`rail.ts`), the terrain (`terrain.ts`), the contract between the scene and its modules (`modules.ts`), performance plumbing (`perf.ts`) and the art modules that build the places, the light, the water, the forest, the sky and the progress lanterns. `src/lib/` also still holds `world-v2/` to `world-v5/` and `world-codex/`, the earlier versions, which only their own development pages use. |

### The world's components (`src/components/`)

| File | Owns |
|------|------|
| `world/WorldStage.tsx` | Mounted by the `/world` layout. Reads the route segments below it: the first names the open place, the second the open lesson. Provides that as `useWorldStage()` (`base`, `openAreaId`, `lessonId`, `href()`), and renders `WorldMap` and then the route's children. The address is the only source of truth for what is open. |
| `world/WorldMap.tsx` | The map's host. Joins the catalog, the student's finished lessons and the address into the one input `WorldV6` takes (`WorldSource`), and turns the map's four callbacks into address changes. Shows one of four plain cards when the catalog is not ready. It writes nothing. |
| `world/useMapModel.ts` | `useMapModel()` names the five states the world can be in (`loading`, `error`, `empty`, `shape`, `ready`) for the host and for the routes drawn over it. |
| `world/PlaceRoute.tsx` | What `/world/[areaId]` renders: nothing for a known area, a card for an unknown one. |
| `world/LessonScreen.tsx` | The lesson page (see Student Surfaces). It reflects the server's answer about completion and has no way to decide it. It takes an optional `transport` and hands it to the player; `/world` passes none. |
| `world/LessonPlayer.tsx` | The video player. It asks for the lesson's embed address, puts Tella's frame on the page, attaches `tella-player.ts` in the same commit that mounts the frame, resumes from `last_position_seconds` when that is past 10 s and the lesson is not past 95%, and feeds the heartbeat. Once a heartbeat comes back accepted with the 95% point reached, it asks `lesson-watched` to count the lesson, and it keeps asking on later heartbeats until the answer is yes: one request at a time, at most one every 10 s, and a request the wait holds back is made when the wait ends. A request that fails is made again by the same timer when the 10 s end, three times at most, and the count starts again on the next heartbeat past 95%. It also asks once on opening a lesson whose stored row is already past 95%. Three lines can show under the progress line. A refusal for too little played says how much was watched and how much is needed. A video that played to its end while the server's answer to that last heartbeat still says the 95% point is not reached says the lesson finished and did not register; that state means the catalog's length for the lesson is missing or too long, and only the team can fix it. A player that has said nothing 12 s after its frame was put on the page says the video did not load (the clock runs from the mount because Tella's `ready` was measured to arrive before the frame's own `load` event in 20 of 21 loads, and a frame that never loads must still get the line), and the frame stays on the page. A reopened lesson's progress line starts at its stored position. Once a video is on the page it stays there: `recorded` turning false under it removes nothing, and the address is not asked for again. Its three calls go through a `LessonTransport` (default `realLessonTransport`). The wording of the three lines is in `.impeccable.md`. |
| `world/LessonText.tsx` | Draws a lesson's text on the lesson page from the blocks `lesson-text.ts` read: paragraphs with line breaks, bullet lists, numbered lists that keep their numbers, bold, and https links that open in a new tab with `rel="noopener noreferrer"`. React elements only, never `dangerouslySetInnerHTML`. |
| `world/AreaScreen.tsx` | Exports `Panel`, the full-screen layer with one card that the lesson page and the two "not here" messages are drawn in. |
| `world/WorldAccessGate.tsx` | Sends anyone `canSeeWorld()` refuses to `STUDENT_HOME`, and renders nothing until it knows. |
| `world/WorldCanvas.tsx` | The first prototype map (loads `public/world/world.glb`). Only the development page `/dev/world` mounts it. |
| `world/AreaLessonList.tsx` | The lesson rows of the earlier area screen. Only the development page `/dev/area` uses it. |
| `world-v6/WorldV6.tsx` | The v6 map and everything drawn over it: the header, the card beside the student's place, the chip, the place panel, the timeline, the done card, the phone list view and poster mode. `WorldV6({ source })`: with a `source` it shows a real student and reports clicks to its host; with none it is the development page on fixture data. |
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
| `StudentContext` | `/dashboard`, `/dashboard/playbook`, and on branch `world-engine` also `/world` and its two child routes (mounted by `src/app/world/layout.tsx`) | Lessons, completions, streaks, discount state (NULL `first_paid_at` blocks claim post-v75.26), sprint milestones, playbook welcome, first-client landed, action-shipped toggles, etc. For the world it also provides `watchProgress`, `patchWatchProgress`, `markWatched`, `catalogSuffix` and `loadError`. |
| ~~`AdminScopeContext`~~ | — | Removed in v75.51. Cohort is the only admin view; no toggle. |

## Integrations

| Integration | Used for | Env vars |
|-------------|----------|----------|
| Supabase | DB + auth + RLS | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Whop | OAuth, promo codes, watch sync, membership webhooks | `WHOP_CLIENT_ID`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_PRODUCT_ID`. No code reads `WHOP_CLIENT_SECRET`, which this row used to list: the OAuth flow is PKCE and sends no secret. |
| Discord | Day-28 DM, churn DMs | `DISCORD_BOT_TOKEN` |
| Tella (branch `world-engine`) | Lesson video for `/world`, as an embed in an iframe. The browser gets one lesson's embed address per request from `POST /api/student/lesson-video`, which needs no Tella value. The server talks to Tella's API in one place, the lock check. | `TELLA_API_KEY`, `TELLA_EMBED_DOMAINS` (the lock check only; see the table below) |
| Vercel | Hosting + cron + analytics | `vercel.json` |

**The world's own settings** (branch `world-engine`, names only):

| Env var | Read by | What it sets |
|---------|---------|--------------|
| `CATALOG_TABLE_SUFFIX` | `src/lib/catalog-tables.ts` | Which catalog the app reads: empty for `lessons` and `regions`, `_next` for the staging pair. Server side. |
| `CATALOG_SHAPE` | `src/lib/catalog-tables.ts` | Empty, `v1` or `v2`: whether the catalog has the v2 shape. Server side. |
| `NEXT_PUBLIC_WORLD_PREVIEW_IDS` | `src/lib/world/access.ts` | The allowlist: student ids, comma separated. Unset admits nobody. |
| `NEXT_PUBLIC_WORLD_LIVE` | `src/lib/world/access.ts` | `true` opens `/world` to every student. |
| `NEXT_PUBLIC_STUDENT_HOME` | `src/lib/world/access.ts` | Where a student who may not see the world is sent. Default `/dashboard`. |
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
(from `grep -rhoE 'process\.env\.[A-Z_0-9]+' src/` on 2026-10-07).

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

## Testing

No test runner is installed and nothing runs on a push. Each harness
below is a script someone starts by hand, from `30-day-sprint/` unless
the row says otherwise. Node 22 runs the TypeScript directly
(`--experimental-strip-types`).

| Harness | Command | Needs the dev server | What it covers |
|---------|---------|----------------------|----------------|
| Client tests | `npm run test:client` | No | Eight suites, run from the real source files in `client-tests/`. On 2026-10-12, after decisions D14 to D19: 312 checks, 0 failed: `watch-heartbeat` 91, `watch-rules` 16, `catalog` 22, `access` 12, `map-model` 34, `tella` 75, `tella-player` 62. On 2026-10-14 the `lesson-text` suite was added (62 checks, every rule of a lesson's text format, `javascript:`, `data:` and `http:` refused, broken links and an unclosed `**` shown as written, the 8000-character cut, Windows line ends): 374 checks, 0 failed. The `tella` suite proves the id pattern, the exact embed address, that `WATCH_SPEED_CAP` and the SQL file's `v_speed_cap` are the same number, every rule of `judgeLock` with its two catalog sentences, and `watchLessonSeconds`. The `tella-player` suite proves the message parser, and who `attachTellaPlayer` listens to and posts to. The heartbeat suite proves that reports 250 ms apart count at 1x, 2x and 2.5x and that a skip does not, that reports handled back to back after a 1 s stall lose nothing, that the allowance never holds more than 5.35 s, that a forced beat that fails or is held back by the gate is sent again after 2, 5 and 10 s and then given up, that a failing database call is tried every 15 s, and that each answer comes with the beat it answers. It proves nothing in a browser, nothing about what Tella's real player sends, and no route or database. |
| Migration tests | `npm run test:migrations` (once before the first run: `npm install` in `supabase/migration-tests/`) | No | Migrations v92 to v101 on a local Postgres (PGlite), with the generator of v101, the two undo files, the morning kit, the video load and the course check. On 2026-10-13: 276 assertions, 0 failed (the run ends `PASS 276   FAIL 0`). It was 188 on 2026-10-12, before sections 20 and 21 were added. With `LESSON_VIDEOS_SQL` set to the path of a filled copy of the video load, seven more assertions run that file, 283 in all. The SQL runs, a second run changes nothing, column types and progress numbers stay put, and the heartbeat function holds against a hostile caller. For v100 (section 18): `lesson_videos` is private and its three constraints hold, a lesson with no `lesson_videos` row is refused, a 2.5x beat is credited in full, the 60 s cap and the first beat's 20 s hold, a forced replay with no time passed gains under half a second, and the function is v97's with exactly five changes. For the lock: the function takes it once, after the student lookup and before the watch row is read; a call holds one exclusive lock, keyed on its own student and lesson, until its transaction ends; and calls served one at a time are credited as one (four calls of 60 s get 60 s between them, and three first calls at the end of a 67 s lesson bank 20 s). The race the lock closes is NOT reproduced: the harness has one connection and cannot fire two calls at the same instant. For the undo: with rows in the table it refuses, says how many and changes nothing; with the table emptied it restores v97's function character for character, drops the table, runs twice, and v100 applies again after it. For the morning kit (section 19): stamp, proof and unstamp run in order with fake ids, the stamp and the unstamp refuse a placeholder left in, the stamp refuses when a lesson it picked holds a video that is not one of the two test ids, no result shows a video id, and the unstamp leaves `lesson_videos` empty. For the course catalog (section 20, 52 assertions): `build:catalog -- --check` exits 0, and exits 1 on a copy of the data file with one title edited; the generator refuses eight bad data files and writes nothing, three of them a brief with a link (an `http` address, a bare domain, a `www.` address); v101 turns v94's 145 placeholders into the 141 lessons, row for row as the data file has them, writes no length, leaves the live catalog untouched and on a second run changes no column but `updated_at`; a copy that would retitle or drop a lesson with a video row is refused, so is a copy that would turn such a lesson into a `setup` lesson, so is a run while a video row waits on a course id that has no lesson yet, and so is a first run while a watch row sits on a placeholder lesson; it runs on a database v100 has not been applied to; the undo refuses while a video row or a watch row points at a course lesson, and otherwise puts back what v94 and v99 left; `course-catalog-check.sql` returns the expected table and each of its four checks moves when a bad row is planted. For the video load (section 21, 36 assertions), with made-up ids: the template is refused as tracked; every kind of bad list is refused with nothing changed, a list with one wrong title among them; a first load of 5 lessons, the same list again, a lesson given another video, a lesson dropped from the list and a video moved to another lesson each end as the list says; a course lesson that is not in the list loses its length whatever its type; a test stamp on the live lesson `l004` is untouched through every load, and a list holding that video is refused; the data route's and the video route's reads find exactly the loaded lessons; a heartbeat for a loaded staging lesson is still refused before the cutover; a course lesson placed in the live table gets and loses its length there with the list, and is held to the title it has there; and the load is refused where v100 or v101 has not run. v99 runs as a step of section 20, and nothing checks what it wrote. It proves nothing about production: how Supabase grants a new table to `service_role`, or the SQL editor running a block and a select on one connection. |
| Lesson player simulation | `node world-tests/lesson-player-sim.mjs` (`S3 S5` for some sections) | No. No database, no login and no network either | The real `LessonPlayer.tsx`, `tella-player.ts`, `watch-heartbeat.ts`, `tella.ts`, `lesson-transport.ts` and `call-gate.ts`, loaded into headless Chrome and driven through whole visits to a lesson: watched through, skipped then watched at 2.5x, a claim that is refused, held back, failed or slow, a resumed lesson, a video that says nothing or whose frame never loads, a change of lesson, the real transport's two requests, a lesson that ends without reaching its 95% point, an end heartbeat that fails, a lesson the catalog disowns for a moment while it plays, and a page whose main thread is held up while the video plays on. 138 checks on the code as it stands after decisions D14 to D19 (run 2026-10-12). About 5 minutes. It proves nothing about what Tella really sends or obeys: the frame is a stand-in written from the PRD's contract, and the server is a stand-in too. |
| Lock check, live | `node world-tests/tella-lock-live.mjs` | No. It needs the network and `TELLA_API_KEY`, `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` in `.env.local` | `fetchTellaVideoFacts` and `judgeLock` from the real source against the two real test videos: two `GET` requests to Tella's API that change nothing, each given up after 10 s, and nothing written anywhere. It has no catalog to read, so it judges both videos as a `watch` lesson 67 s long, the length the stamp file gives the two test lessons; it fails on the length rule if a test video is recorded again at another length. It expects both videos `open` with one problem naming `localhost`, and both `locked` once `localhost` is expected. It prints how long Tella took to answer, and neither the key nor an id. It proves nothing about the cron route around that logic (the table read, the writes, the alert), and the `missing` verdict has only run against a stubbed answer. Its last recorded run (project log, 22:19) was before it judged against a catalog length. **Run again on 2026-10-13 it fails: `PASS 0   FAIL 2`, both videos judged "Tella no longer has this video."** The key in `.env.local` was changed that day to the workspace that holds the course, and Tella answers 404 to it for the two test videos, which were made under the earlier key. The two test videos still play on the development page (`tella-watch.mjs` passed the same evening). The locks of the course's own videos are proved by the Tella tool's `check`, outside this repository. |
| Lock check simulation | `node world-tests/lock-check-sim.mjs` | No. No database, no network and no `.env.local` either | The lock check's real route file (`src/app/api/cron/check-lesson-videos/route.ts`) with the real `tella-lock.ts`, `tella-api.ts`, `cron-auth.ts` and `discord.ts`, loaded as they are and run against stand-ins for `fetch`, the Supabase client, `NextResponse` and the clock. On 2026-10-12: 89 checks, 0 failed, in under a second. It proves the route's own logic: the refusals (401 without the secret, 500 without the key or the domain list, 500 when the table of videos cannot be read); one row of every kind with its verdict, its sentences and what is written; the write filtered on the lesson and the video; a row swapped or deleted while the run is on; the 270 s budget, with no request started after it, `notReached` saying how many were left and the next run starting with them; the pace of one request per 700 ms, 86 a minute at most; when the alert is sent, what it says and its cut at whole lines under Discord's limit; a catalog table that cannot be read, a write that fails and an alert that does not go out, with what `cron_runs` says after each; and that no video id and no key is in any answer, alert, `cron_runs` row or log line. It proves nothing about real Supabase (how supabase-js and PostgREST treat the order and the two filters, row level security, how long a write takes), real Tella, real Discord or Vercel's clock. Every timing in it is an input on a pretend clock, so it confirms the arithmetic of how many videos fit and measures nothing. |
| Tella browser proof | `node world-tests/tella-watch.mjs` | Yes, on port 3111, with `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` in `.env.local`, and the network | The real `LessonPlayer` against Tella's real player, on `/dev/world-app` with a pretend student and a stand-in for the server. Nine rows from the PRD's path table: watched start to finish (T1), skipped to the last 3 s (T2), skipped then watched from the start (T3), watched at 2.5x from the player's own menu (T4), left at about 20 s and resumed (T5), a video Tella refuses (T6), a lesson with no video (T7), no request to `/api/student/*` and a paused map while playing (T8), and `v6-app.mjs` still passing (T9). Five gaps print as NOT COVERED: the real route, database function and completion on production (G1), a lapsed member or a caller with no login being refused (G2), other browsers, devices and a real click (G3), a background tab (G4), the alert reaching Discord (G5). On the code as it stands after decisions D14 to D19: `PASS 9  FAIL 0  NOT COVERED 5` (run 2026-10-12, 23:38 to 23:45). The script tells the end of a video by position, because the real player was seen to end one replay on `paused` with no `stopped` after it; a run made before that change failed row T3 on the wait alone, with the lesson correctly counted on the page. |
| Offline v6 map tests | `node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/<file>` for `v6-route.mjs`, `v6-gate.mjs`, `v6-locked.mjs` and `v6-a2-foundations.test.mjs`. `v6-rail.test.mjs` takes the same flags plus `--expose-gc`. | No | The map's route, camera rail, cave, gate, locked stretches and quality logic, measured from `src/lib/world-v6/` with no browser. Each exits 1 on a failed check. |
| Dev map page checks | `node world-tests/v6-ui.mjs checks` | Yes, on port 3111 | The interface of `/dev/world-v6`. The script launches Chrome with a software renderer (SwiftShader), so the page runs in poster mode: it covers the interface and leaves the live 3D path uncovered. |
| World browser proof | `node world-tests/v6-app.mjs` (`--only 3,5,18` for some rows) | Yes, on port 3111 | 20 rows on `/dev/world-app`, on the real GPU: arrival, Watch, finishing a lesson and a place, deep links, unknown addresses, the phone view, poster mode, reduced motion, the four not-ready cards. It takes about 3 minutes, and three gaps print as NOT COVERED (a real login with a real video, other browsers and devices, the `look` and `locked` modes with a real student). The default catalog it walks is unchanged by the course mode: `PASS 20  FAIL 0  NOT COVERED 3` on 2026-10-13 (course-catalog project log). |
| Course browser proof | `node world-tests/v6-course.mjs` (`--only 2,4` for some rows) | Yes, on port 3111. Rows 9 and 12 also need `DEV_TELLA_VIDEO_ID` and `DEV_TELLA_VIDEO_ID_2` in `.env.local`, and the network | 20 rows on `/dev/world-app?catalog=course`, on the real GPU: the map takes the real counts, every lesson has a lantern, each place's card, each place's panel, the action items, the pond, the total, 26 ticks fitting the card, a lesson page with a video, a lesson page without one, an action item's page, a course lesson watched to the end of the test clip, and since 2026-10-14 four rows on `?text=sample` for the lessons' text (a5l22 with no video: no player and no 16:9 box, the text right under the Milestone box; a5l08: the player, the Milestone box, then the text; the https link opens in a new tab with `noopener` and the `javascript:` one is no link; a7l01 with no video and no text: "Not recorded yet." on one short line). Five gaps print as NOT COVERED (how the eight stops look with the real names, which a person judges from the screenshots; the default page, which `v6-app.mjs` proves; lanterns in uncleared ground cover; the real login and the real server; how a lesson's text looks, from two screenshots). On 2026-10-13: `PASS 11  FAIL 1  NOT COVERED 4` (course-catalog project log). On 2026-10-14: `PASS 15  FAIL 1  NOT COVERED 5`; with rows 17 to 20 added the same day (the video asked for before the click: a hovered row is asked for once and its frame is in the page within 300 ms of the click, also with `?latency=1500`; the "Loading video…" placeholder until the player's first word, with a screenshot, `lesson-video-placeholder.png`; a lesson with no video is never asked for), `PASS 19  FAIL 1  NOT COVERED 5`. The 300 ms includes the dev server's route change to the lesson page, so rows 17 and 20 can miss it on a busy server (one run of two, 482 and 376 ms); they print the two parts. The failing row is known and left failed: place 3 puts down 19 lanterns for 25 lessons. With the placeholder course the same place puts down 17 for 22. The counts, the place names, the action items and the pond row it expects are typed into the script, and the titles and briefs are read from the data file. About 7 minutes. |

The five browser scripts (`v6-ui.mjs`, `v6-app.mjs`, `v6-course.mjs`,
`lesson-player-sim.mjs`, `tella-watch.mjs`) need `npm install` once in
`world-tests/` (`puppeteer-core`) and Google Chrome installed at its
default macOS path. For the four that need the dev server, start it
with `PORT=3111 npm run dev`; `BASE_URL` overrides the address the
three map scripts open. Screenshots land in `world-tests/shots/`, which
git ignores (the Tella proof's under `world-tests/shots/tella/`, the
course proof's under `world-tests/shots/v6/course/`).

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
| Add a new DM template | `/admin/templates` (UI, not migration) |
| Run a one-off DB change | New migration in `supabase/migrations/`, idempotent |
| Update CONTEXT.md | When you add/rename/delete a route, table, context, or lib module |
| Update system_contracts.md | When you add a table, or change which fields outside callers depend on |
