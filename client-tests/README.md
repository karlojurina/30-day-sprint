# Client tests

No test runner in this repo, and adding one (vitest/jest + a DOM shim) is a
bigger change than the thing being tested. Node 22 strips TypeScript natively,
so these run with no build step and no new dependency:

```bash
node client-tests/build.mjs
node --experimental-strip-types client-tests/watch-heartbeat.test.mjs
```

or `npm run test:client`.

## How it stays honest

`build.mjs` copies the **real** `src/lib/world/watch-heartbeat.ts` and rewrites
its three import lines and nothing else: `@/lib/supabase-browser` and
`@/lib/call-gate` point at local stubs, and `./tella` gains the `.ts` Node
needs. The Supabase stub is wrapped in a three-line counter, so the test can
prove that a heartbeat handed its own `rpc` never builds a client. That
counter is the only code in the generated file that is not in the source.
Everything else is byte-for-byte the shipping source. If the test passed
against a retyped copy it would be testing a fiction.

The other modules under test are copied the same way (`build.mjs` lists them,
with what each one needed rewritten). A copy that still holds an `@/` import
stops the build. So does a copy that leaves out comment lines
(`dropComments`, `dropLineComments`) and then makes other JavaScript than its
source with the imports rewritten, both run through TypeScript's
`transpileModule` with comments removed (2026-10-20): a line of code that
starts with `//` or `*` stops the build instead of going missing. The check
runs before the copy is written, so such a copy never reaches `_gen/` (a code
line starting with `*` put into `whop-members.ts` on purpose: the copy left on
disk before, none now).

Server code is copied too (since 2026-10-16): the Whop backfill and the visit
route that runs it, the Whop webhook, `mark-action-shipped`, `skip-lesson`,
the CSM's event hooks, and the two routes that write a discount request
(`request` and `submit-feedback`, for a double submit refused by v106's
index, which the stand-in has under its real name). A database function a
route calls through `.rpc()` is a stand-in the test writes itself, from the
migration's body. Their imports go to `_gen/stub-server.ts`, a
hand-written stand-in for Next's response, the service-role Supabase client
(rows in plain arrays, answered the way PostgREST answers where a route depends
on it: `.single()` on no row is an error, a select returns only the columns it
names, `ON CONFLICT DO NOTHING` returns only the rows it added), Whop's
completions read, the steps after a lesson (recorded in order) and the catalog
flags. Each test calls the route's own `POST` with a real `Request`.
Since login-1 (2026-10-20) the webhook's copy imports the real
`whop-members.ts` instead of the stand-in, so `whop-webhook-product.test.mjs`
runs the real Whop lookup on a stand-in `fetch`; that copy leaves out every
comment line (`dropComments`), since one of them names two people.
`whop-webhook-old-rows.test.mjs` runs the same copy for a row the webhook
wrote for another product before login-1, which closes when that membership
ends. `whop-webhook-product.test.mjs` also sends a course payment in six
shapes: the row points at `membership.id`, else `membership_id`, else
`membership` as a bare id, and at the payment's own `pay_` id only when the
payload names none (until 2026-10-20 it always took the `pay_` id).
`whop-backfill.test.mjs` also checks the login callback's one streak line in
the source; since T-079 `streak.test.mjs` runs the callback itself (below).

Since T-079 (2026-10-17) `streak.test.mjs` runs every route that writes or
shows the streak through its own entry point: `lesson-watched` and the webhook
with the real chain after a lesson (`complete-lesson.ts`), the visit's
backfill, `mark-action-shipped`, the old course's `toggle-lesson`,
`submit-quiz` and `skip-lesson`, the app's data read, and the login callback
itself (`GET`, with Whop's login calls, the password sign-in and the redirect
as stand-ins in `stub-server.ts`, and the real `pkce.ts` signing the state;
its copy leaves out the source's `//` comment lines, because two of them name
a student and a customer's email and this repository is public).
The streak's steps are the one exception to "recorded, never run": the stub
records `updateStudentStreak`, `tickStudentStreak` and `markStudentActive`,
then runs the real `update-streak.ts`, so the suite reads the
`student_streaks` row and `students.last_active_at` each route left. Next's
`after()` is a stand-in too: it keeps the work a route hands it in
`afterTasks`, so a test can let the response go first and then wait for that
work, and `setAfterMissing(true)` makes it throw as Next's does where the
platform has no `waitUntil`. Each of the suite's fixes was broken on purpose
once, and the suite failed every time.

The closed doors before the new course (T-078, 2026-10-17) have two tests.
`student-app-gate.test.mjs` imports `src/lib/student-app-gate.ts` straight
from `src/` (its one import is a type, so there is nothing to rewrite), asks
the rule open, closed, allowlisted and for the team against a small database
that records every read, and reads the source of every route under
`/api/student` and of the team's surfaces. The same file runs on `main`, where
no harness exists. `student-app-gate-routes.test.mjs` runs 8 real student
routes (the data route, lesson-video, lesson-watched, the Whop backfill,
mark-action-shipped, skip-lesson and the two discount writes) through the real
gate's copy: unset, closed, closed with the student listed, closed with
someone else listed. The callback's door is checked in the source;
`streak.test.mjs` runs the callback itself with the app open.

`discount-september.test.mjs` (T-080, 2026-10-17) runs the week of a student
who first paid in early October (from 1 October until the launch; the group
began on 9 September until Lovro moved it on 2026-10-19, hence the name, and a
September payment is now refused there too) through the backfill, the
webhook and the request route on a calendar it
sets itself: `at(iso, fn)` swaps the global `Date` for one whose `new Date()`
and `Date.now()` answer that moment, for the length of `fn`, so the stand-in
database stamps a completion (its `now()` default) and the route judges at the
moment the story needs, on whatever day the suite runs. It drives both ways
the map applies (the questions form's route and the plain request) for a
student who already holds a request from the old dashboard; the form's
database function stands in from v29's body, and the migration harness
(section 26) runs the real one on the same four cases.

`whop-catchup.test.mjs` (T-089, 2026-10-20) runs `POST /api/admin/whop-catchup`
through its own `POST`: the route, the run (`src/lib/whop-catchup.ts`) and the
real team login (`admin-auth.ts`, so 401 and 403 are its own answers, on the
stand-in's auth and `team_members`). Whop is the real `whop.ts` read on a
stand-in `fetch` that pages like Whop's v1, so every failure the run sorts by
kind is the read's own message. Its clock is the suite's: `new Date()` and
`Date.now()` answer it, and `setTimeout` sets a timer on it. Timers fire in
the order they fall due, one per turn of the event loop, each moving the
clock to its time, and `clearTimeout` drops one; Whop's answer time is such a
timer. So the pace (4 Whop requests a second), a 429's wait, the 240 s budget
and the 285 s limit on one Whop read pass in milliseconds and are measured,
and a read that answers late loses to that limit as it would on Vercel. A
login racing the run is a hook on the stand-in's log: it writes the same
lesson after the run read the rows and before the run's insert or update
applies. For it `stub-server.ts` gained `.range()` (for
`fetchAllRowsPaginated`), the columns a select named on its log entry, and
`students.csm_exempt` and `whop_plan_id`. Each of 19 rules was broken once in a
copy of the run, and the suite failed every time. The review the same night
found 6 breaks it let through: no `ignoreDuplicates` on the insert, no guard
on an empty `completed_at` when finishing a row, no budget check before a
429's wait, the streak ticked from the planned rows and the finishes counted
from the planned ones instead of the rows written, and no pace after a failed
read. The sections added in its fix round fail on each of those 6, and on 8
breaks of the two rules that round added (the read limit, and no tick for a
streak that already counts today). `streak.test.mjs` runs the catch-up's one
streak rule too.

`achievements-v112.test.mjs` (2026-10-21, the badges for the new course,
migration v112) runs every rule v112 changed on the real files:
`achievements.ts` and `achievement-rules.ts` (no imports, copied untouched),
and, through their own entry points on the stand-in database,
`lesson-watched` with its real chain, the webhook, the visit's sync and the
Whop catch-up (`runWhopCatchup` on the real `whop.ts` read over a stand-in
`fetch`). It holds the eight rules and that none of the eight taken out is
awarded to a student who meets their old rules; Triple Threat's
`finishedAt` and `mostFinishedInOneDay` alone and through
`evaluateAchievements` (a sync's three, three on their own, an action item
whose video came by sync before or after its action, a setup action item, a
skip, midnight UTC, and a database without `completed_at_real`, where every
other badge is still judged); which writer marks `completed_at_real` (the
player and the webhook do, a visit's sync does not, the catch-up only on
rows with Whop's own time) and that a failed mark fails nothing; Habit
Builder's `streakDaysSinceSwitch` alone and through the evaluator, the old
rule with no switch and the streak only read; and the share's
`countsInShare` and `sharePercent`, with v112's view naming the same three
conditions (the migration harness runs the view itself against them). The
stand-in's update writes any column it is given, so the column is not
declared in `stub-server.ts`; a database without it is a `failWhen` on the
mark or on the read. Each rule was broken once in the generated copies (17
breaks: the flag ignored, no action item derivation or one past a late sync,
days not in UTC, the whole streak read, days before the switch, the exempt
or canceled members in the share, the share rounded down, Habit Builder from
the best streak, Triple Threat at 2, the evaluator ignoring the read, the
player or the webhook not marking, a mark of false, the catch-up marking the
run's clock or nothing), and the suite failed every time. Since then
`achievements-cutover.test.mjs` holds its parity with the module at
`410e011` for the seven rules v112 left as they were, Habit Builder among
them (with no switch it is the old rule); Triple Threat and the eight taken
out are left out of it.

The crons (bug hunt of 19 October) run with less stood in than the routes
above: `engagement-alerts.test.mjs` copies the real route, `discord.ts`,
`cron-auth.ts`, `dm-toggles.ts` and `supabase-server.ts`, so the database is
reached by a real supabase-js client. Only the network is stood in, by
`_gen/stub-cron.ts`: a PostgREST over plain rows that answers the requests
the client really sends (its URLs, headers and methods, a request line past a
gateway's 8 KB refused with 414), and a Discord webhook with Discord's
documented limits (4096 characters an embed, 6000 a message, a rate limit
answered 429 with Retry-After). The route as it stood at production (70c934a)
is taken from git and run beside it: one embed for 60 alerts is refused and
the run says success; now every alert lands once, across one message per
embed, and a post that fails marks the run failed with the reason.
`cron-failed-reads.test.mjs` runs check-na-tasks, check-engagement and
check-csm-tasks the same way, with `failWhen` failing one read at a time (the
student pool, the milestones, one student's completions, the open alerts, the
past-due canceling students, and since the review of 20 October
check-engagement's two Discord toggles, now read before its insert): each run
now stops with a 500, cron_runs failed and nothing written, where the copy
from 70c934a wrote wrong tasks, alerts or dismissals and said success (a
failed toggles read: the new alerts inserted unposted, for good). With 250
students the pool-wide reads go out
100 ids at a time, each request line under 4,500 characters; the old single
request passed 8 KB and was refused. The copies of `dm-toggles.ts`,
check-na-tasks and check-csm-tasks (now and at 70c934a) leave out every
comment line (`dropComments` in both files' `write()`), since some name team
members and this repository is public; the code is checked unchanged on
every run (TypeScript prints the source and the copy without comments, and a
difference stops the test).

`phones-input-zoom.test.mjs` (phones-2) is a source check, since no harness
renders the action item or the 30% form without the dev server: it parses
`world-ui.module.css` and `discount-form.module.css` into their rules and runs
the cascade for a phone (pointer coarse, 390x844) and a mouse (1366x768). The
link field and the text answer are 16px on the phone, so iOS Safari does not
zoom into them, and 13px and 15px with a mouse, as before. Its cascade is
its own; `node world-tests/phones-input-zoom.mjs` loads the same two files
into headless Chrome (touch emulation and a mouse) and reads the sizes back
from the browser's cascade, with the files at 70c934a beside them (13px and
15px on touch).

`terrain-identical.test.mjs` (2026-10-20) proves that the map's faster
terrain (`src/lib/world-v6/terrain.ts`) gives every number the old one gave.
The old one is `fixtures/terrain-70c934a.ts`, byte for byte the file at
production's commit; `build.mjs` copies the current one and `layout.ts`, the
test copies the fixture, and both run over the meshes the scene builds, about
3.8 million heights and shore radii over the world and past it, and the edges
of the new code's tables. Every value is compared as its bytes and the whole
through SHA-256; then both are timed. A change to the terrain's output on
purpose fails it by design: the test's header says what to do.

`function-regions.test.mjs` (2026-10-20) reads `vercel.json` and the source
under `src/app`. The project runs in `dub1`; each route pinned to `iad1`
under `functions` must be an exact path to an App Router route file that
exists, with its regions named; and no route may export `preferredRegion`
outside the edge runtime. Vercel takes a Node route's region only from
`vercel.json`, and its CLI lets a `src/app/` entry that matches no file pass
in silence, so a moved route would otherwise lose its pin unnoticed. A
renamed key and a `preferredRegion` export were each put in once on purpose,
and the test failed both times.

`thirty-view.test.mjs` (admin rebuild, work item 2, 2026-10-20) runs the
admin's bulk 30% loader (`src/lib/admin/thirty-data.ts`) and the 30% page's
builder (`thirty-view.ts`) against `loadDiscountReads`, one student at a time,
on the same stand-in database, for every fixture: the reads, the state, the
counts and every verdict must match. For it the stand-in answers the way
PostgREST does where paging depends on it: no select returns more than 1000
rows, `.range()` returns one page after the order, `.order()` called twice
orders by both columns, `failWhen` fails one batch of a bulk read, and
`shuffle` hands rows back in no fixed order wherever a read's order leaves
them open. Since the review of 2026-10-20 each read of completions holds only
as many students as fit in one page, so it is one query: the suite checks that
no read is asked for twice, and that a request decided between the pending and
the decided reads is listed once, as decided. Its controls, written into
`_gen`, put back 100 students a read (`thirty-data.hundred.ts`) and, on top of
that, skip paging or page without a unique order; each must fail the same
check, and does. With 100 a read, a completion deleted between two pages of a
read drops another student's row (the check fails for that student); with the
real loader nothing is asked for twice and nothing differs.

`admin-routes.test.mjs` (admin rebuild, work item 3, 2026-10-20; until
admin rebuild 2 `admin-today-routes.test.mjs`) runs the rebuilt admin's
routes through their own handlers: `GET /api/admin/thirty` and, since
admin rebuild 2, `PUT /api/admin/config`. Its login is the real team
check: `build.mjs` copies `src/lib/admin-auth.ts` with Next's response
and the Supabase client pointed at `stub-server.ts`, so the token is
looked up in the stand-in's users and the member in its `team_members` (a
founder, two csm members, an admin for the config route and a student who
can sign in, all made up), and a call gets the 401, 403 or 200 it would
get on Vercel. The 30% route's answer must equal the loader and the
builder run on the same database at the same moment, read nothing it may
not and write nothing, and fail in plain words. Eight mutations of the
copies (a role left out, a failed login or read answered with a list, the
switch's date dropped, the failed read unnamed, `maxDuration`, a login
with no team row let through) each make it fail. The config route (admin
rebuild 2, D6) must save each of the 6 keys of
`src/lib/admin/config-keys.ts` for a founder and an admin, with who saved
it and when, and refuse with nothing written (no update even sent)
`curriculum_reset_at`, the old `discount_window_days`, a key not in the
table, a switch set to "yes", "True" or a JSON boolean, a link with no
value or null, and a body that is not JSON; a csm, a student and no token
are refused; a missing row is a 404 and a failed write a 500, both in
plain words. The 4 switches must be dm-toggles.ts's `DmToggleKey` union,
read from the source. Run against the route before the limit, 12 of its
checks fail. Every error sentence a route answers in it is kept; with
`ADMIN_ROUTE_ERRORS_OUT` set to a file path the suite writes them there as
JSON, and `world-tests/admin-pages.mjs` (work item 5) runs it that way and
holds each sentence to the page's words: no em dash, "unlock" or
"EcomTalent".

Work item 4 (2026-10-20) had added Today's routes (`GET /api/admin/today`,
`POST`/`DELETE /api/admin/today/mark`) to that suite, and
`support-list.test.mjs` ran Today's builder; admin rebuild 2 removed
Today, and with it those checks, that suite and their copies in `_gen`
(`support-list.ts`, `today-data.ts`, the two route copies, and
`templates.ts` and `database.ts`, which only Today's builder read).

`admin-frame.test.mjs` (admin rebuild 2, WI-1, 2026-10-20) checks the
admin's frame and what admin rebuild 2 removed, with no browser. From
`src/lib/admin/admin-frame.ts` (copied by `build.mjs`): the top bar a
founder, an admin and a csm get, in order (Dashboard · 30% off · Tasks ·
Students · Feedback · Templates · Insights · Team, Feedback hidden from a
csm and Team a founder's only), no "More" and no entry about a plan or a
subscription, each entry a page file that exists, the entry marked for 14
addresses, and `isRebuiltPage` keeping `/admin` to itself. From the
source: sign-in, set-password and the lockup go to `ADMIN_HOME` (`/admin`),
the root page, StudentGuard and the error page send the team to `/admin`,
layout.tsx lists only the 30% page as dark, and the bar draws no pill.
The 17 removed files and folders are gone, vercel.json pins none of their
routes, and no file under `src/` holds a quoted address of a removed page
or route or imports a removed module (the same scan finds 1, 6, 1 and 1
such lines in four files at `d0ebe76`). `whop-products.ts` holds the 2 Whop
product ids `etfb.ts` held at `d0ebe76` (read with `git show`), in the
`export const NAME = "...";` form login-1's test reads, and its first line
says so. With Today put back first in the bar and `/admin` matched as a
prefix, 9 checks fail.

`dashboard.test.mjs` (admin rebuild 2, WI-2, 2026-10-20) checks the
Dashboard's numbers, `src/lib/admin/dashboard-metrics.ts` (copied by
`build.mjs` over the real `metrics-definitions.ts`, `curriculum-reset.ts`
and `discount.ts`): Month 2 counts only the students who first paid on or
after the launch (a first payment at the launch second counts whichever way
it is written; the students from before it, who would make a rate without
the floor, never do) and waits with the first renewal's date (a calendar
month after the first payment) and the first rate's (that payment plus 30
days and a week of grace); once renewals resolve, the rate and a line whose
days before the first resolution are gaps and whose last point is the big
number. Bounty keeps its count; Churned adds exactly 14 days; a day with no
snapshot is a gap; Avg progress's number is its line's last point and the
line starts on the switch's date. A count that did not come back, a paged
read's empty list with an error, a broken `tasks_reset_at` and a failed
settings read are failures, each failing every tile it feeds, named once.
Refresh's line names a step that failed inside a 200. The page's
`readDashboard` is taken from `page.tsx` with TypeScript's parser and run on
a client that records every call: the open tasks get the tasks reset's floor
only when the key exists and are not counted without it, 30% to decide
counts the pending requests from 1 October, the students read names its 6
columns and pages by id. 81 checks.

`admin-people.test.mjs` (admin rebuild 2, lane WI-5 and WI-6, 2026-10-20)
runs the rules of Tasks, its insights, All students, a student's page and
the Student journey. The readers (`src/lib/admin/students-list.ts`,
`student-detail.ts`, `journey-board.ts`, copied by `build.mjs`) run on
`stub-server.ts`'s database: since the owner's answer of 2026-10-21 All
students holds a first payment on one of the course's two $97 monthly plans
(`MONTHLY_97_PLAN_IDS`: the visible one and the hidden one; every
membership, no Whop membership) and never a yearly plan, an ETfB plan, no
plan on file, a $97 member with no first payment or a free seat, and since
the owner's review of the same day only a first payment from
`DISCOUNT_ELIGIBLE_FROM` on (30 September 22:00 UTC, 1 October in Croatia;
not a millisecond before, nor March, June or September), past 1,000
students read by key, with the list's columns only (the plans are the
read's filter, never a column), and their progress read for them alone, by
id in batches of 100 (12 reads for 1,200 students; one batch failing fails
the read, never a list with students missing); the pills Active, Payment
failed and Ended (canceled and expired together), Active first, each with
its count; the journey holds the same two plans with a first payment from
`DISCOUNT_LAUNCH_DATE` on (not a millisecond before), active, past due or
canceled with a membership, its progress read for the board's students
alone and no area, username or booked cancel read, and on one database it
is exactly the list's students paid from the launch with a live or churned
membership; a journey card holds exactly the name, the day, the activity,
the progress and the last activity; the two readers as they were at
`35d44d2` (git, copied into `_gen/*.before-97.ts`), run on the same
databases, are the control that every plan used to be listed; a student's
latest 30% request is the newest of any date, and the Whop sync read names
no token. The builders run on hand-made reads: the order, the day, the
progress over the counting lessons (a skip counts, a half-done action item
and a lesson outside progress do not), the activity, the six columns at
days 7, 8, 14, 15, 21, 22, 30 and 31 (past due and canceled apart), the
Whop sync's mark on each side of the switch's millisecond (`whopPulled`),
the area a student is in named by the lessons that count (on the student's
page; a journey card showed it too until the owner's review),
and every failed read carried to the page as a failure, never 0% or "no
request". The Tasks rules: the tabs (Archived once the reset ran), the
tiers, the closed lines (the reset's note in plain words), the queue line's
"sent today" in Croatia. `computeOutreachInsights` with and without the
floor, and `GET /api/admin/tasks/insights` (copied here with its imports
pointed at the stand-ins) reading `tasks_reset_at` or answering 500 when it
cannot. The words: "Membership status" and "still a member"; no
subscription in this lane's pages and readers, and no plan read as a
column or shown on a row: All students' and the journey's readers name the
plan only in their one filter on `MONTHLY_97_PLAN_IDS`
(`PAYING_WHOP_PLAN_IDS` left as it was), and both headers say who is
listed. Where the old page held the rule inline, the page at `ca9b5ef`
(git) is the control. 78 checks (68 before the owner's review of the
preview, 61 before the $97 plans came back).
`build.mjs` copies `templates.ts` and `database.ts` again for it (the Tasks
rules read the buckets' order), beside `metrics-definitions.ts`.

`admin-tasks.test.mjs` gained the reset (11 checks): To do, Sent and
Dismissed hold the tasks created on or after `tasks_reset_at` and
`archived` every older one of any status, the line drawn in the database
in every list and count, the reset and the DM links from one read of
`admin_config`, no archived read and no line before v109, and a failed or
unreadable `tasks_reset_at` a 500 with its reason. Its page checks read the
new view (`src/components/admin/tasks/TasksView.tsx`). `admin-pages.test.mjs`
reads the journey's drawer where it lives now (`JourneyView.tsx`, keyed by
the student, fed by the student page's `useStudent`, which it runs on a
small stand-in for React's hooks: a slow answer for the last student is
still dropped) and the ads tick's two sentences in `StudentDetailView.tsx`.
`csm-cutover.test.mjs` and `outreach-cutover.test.mjs` put the old words
back before comparing with their bases ("Subscription status" and "still
subscribed" were renamed on purpose, D12) and ignore the new
`tasks_floor` field; `whop-backfill.test.mjs` and `streak.test.mjs` read the
student page's note and streak where they live now.

The Templates, Survey, Team and Insights pages (admin rebuild 2, WI-8 and
WI-9, 2026-10-20) each have a suite. `build.mjs` copies their data modules
(`templates-data.ts`, `survey-data.ts`, `team-data.ts`, `insights-data.ts`,
the Templates page's transport and `call-route.ts`, whose browser client is
the hand-written `_gen/a2-browser-stub.ts`) and, under `a2-` names so they
never meet another lane's copies, the message renderer and the types file
it reads (`a2-templates.ts`, `a2-database.ts`); the suites compile the
pages' components themselves (TypeScript, JSX to react/jsx-runtime) into
`_gen/a2-*.mjs` and render them with React's server renderer.
`templates-page.test.mjs` (71): the loader on the stand-in database, the
Message settings panel's warnings and switches (held to the crons' own
`readDmEnabled` on 12 combinations), the panel rendered for a founder and
a csm, its saves through the real `PUT /api/admin/config` and `requireTeam`,
the preview's live links, Delete for a custom template only (on the row and
in the route, with the route at `ca9b5ef` as the control), Save sending
only what changed, "Membership status", and the trigger editor reading
nothing itself. `survey-page.test.mjs` (22): 250 applications and 1,500
answers on a shuffled database, every one read once (the old read on
`created_at` repeats or skips answers on 11 of 12 shuffles), at most 100
ids per `.in()`, every failed read named, the 30% page's status words.
`team-page.test.mjs` (14): the invite's `name@ecomuniversity.com`, the
page's first state rendered, its rules, and its calls through the real
team-members routes. `insights-page.test.mjs` (14): the moved reads, each
failure said (they showed 0), the claims counted once on 8 shuffles (the
old read on the claim time fails all 8). `template-on-off`, `admin-pages`
and `csm-cutover` follow the new files and the one renamed label. Each was
also run against a broken copy (Delete allowed for a built-in, conditions
always sent, every template counted for the warning, batches of 300, the
answers paged on `created_at`, the route deleting any template): each
break fails it.

`admin-review.test.mjs` (admin rebuild 2, the review's fix round,
2026-10-21; 98 checks) holds every rule that round added, run as the source
has it: a failed read in plain words with the raw text behind Details
(`read-failure.ts`, copied by `build.mjs`, and `review-parts.tsx`, which the
suite compiles with `ui.tsx` and `list-parts.tsx` into `_gen/ar-*.mjs` and
renders with React's server renderer); Insights' Avg progress from the course
switch and its gridlines at their own values; Lesson feedback's rated lessons
first and the rest one line per area; one name and colour per 30% status
(`discount-status.ts`) on the 30% page, the Survey and a student's page; the
Survey from 1 October with its summary; the 30% page's coupon check on every
row, with the Approved rows asked of Whop by `GET /api/admin/thirty` on a
stand-in `fetch` (live, stored, could not ask), and a stored Whop id that is
missing or a payment's said on the row as no membership to ask about; the
coupon rule's log of a stored id that is not a membership's and the cron run
Whop never answered;
the quick DMs' words; the buttons named for what they do and kept, with the
tabs, while a page loads or failed; the student side's one filled button
while a rating is open; and the removals (no file imports `plans.ts` or names
a removed helper). Where a rule is about words in a file, a control reads the
file at `ff411f6` and shows the old behaviour. `dashboard` (86: also the
expired students Month 2 alone reads, and the Bounty Program without them),
`templates-page` (73), `csm-cutover` (48: `is_canceling`'s select took its
sentence's words, so only the label comparison puts the old one back) and
`thirty-view` (98: the first rebuild's helpers went with their tests) changed
with it.

`admin-render-fixes.test.mjs` (admin rebuild 2, the render review's fix
round, 2026-10-21; 76 checks) holds every rule that round added: a failed
read said in the header too (`FailedMeta`, on the ten pages with a header);
the journey's board in the page's column; the Dashboard's program row
(Bounty left, Month 2 right, as tall as each other), its equal section gaps,
its Today links and Month 2's bar with no knob; the 30% page's and Tasks'
actions on the right (`RowSplit`) and the pill rows on one scrolling line on
a phone (`PILL_ROW`); a student's numbers on one line, a failed read plainly
not a value, the Whop sync in one line with the rest folded; one name part
on every page (`student-name.tsx`, rendered); a marker on every "how it's
counted" fold and `aria-expanded` on Show settings (`MessageSettings`
rendered closed); the not-found page in the admin's frame; the course switch
page in the dark look with every sentence of its `d0ebe76` self; the team's
own ECOM30 code never warned about (`buildThirtyView` over decided rows,
Whop now and stored, named and nameless); a coupon row's Reject alone with
its reason filled in; the not-activated page byte for byte as at `d0ebe76`;
`readAllDmToggles` gone; `system_contracts.md`'s tasks contract. It compiles
the views it renders into `_gen/rf-*.mjs`. A control reads the files at
`8d0f2ff` where a rule is about words in a file. With it changed: `dashboard`
(Avg progress on the 14 days, its readings from the switch, "from" the
switch's date), `membership-discount` (the cron's window on the suite's
clock moved to 5 November: a shared window closed after 23 October and an
own window closed after its 14 days are not read, a pending request is),
`admin-review` (its 30% row, header, fold and removal checks follow the new
rules), `thirty-view` (the coupon's id and `ours` on the row), `lesson-feedback`
(the username its students read) and `streak` (the student page's number tile).

`admin-render-second.test.mjs` (admin rebuild 2, the render review's second
round, 2026-10-21; 53 checks) holds every rule that round added: a coupon
row's Reject starting with the map's own sentence to the student
(`COUPON_REJECT_REASON`, which is `MEMBERSHIP_DISCOUNT_LINE`: no code, no
third person, still the team's to change); "Check Whop again" in Approve's
place on that row, through `checkCoupon` of the transport and
`POST /api/admin/thirty/check-coupon`, which makes no code and writes nothing
itself; the coupon cron reading every pending request whatever its window;
Outreach insights' 5 numbers in the primary ink (`Stat` rendered with no
tone); the Dashboard's header "Couldn't load" when no tile could be drawn
(`nothingLoaded` over the loader's failure, every read failed one by one,
and the reads every tile needs; one tile drawn keeps the time); a short run of
readings drawn as 6px dots joined by their line (`TrendChart.tsx` compiled
into `_gen/rs-trend-chart.mjs` and rendered: 1, 2 and 3 readings, 4, 14, and a
run of 2 between gaps); a username on one line with its ellipsis and title,
and no underline on a name with no student behind it (`student-name.tsx`
rendered), every name part with a username in a wrapping flex line, All
students' cut name and username with their titles; every failed block of a
student's page and of the journey's drawer starting with the tiles' warning
dot (`SectionFailure`); CONTEXT.md's coupon cron lines; `system_contracts.md`'s
tasks contract naming every file of `src` that reads `tasks` (found with
`git grep`) and every route that reads it through `computeOutreachInsights`,
`GET /api/admin/templates/stats` among them; and `/admin/not-activated` still
as at `d0ebe76`. A control reads the files at `22e83fb` (`night/admin2`
before the round). With it changed: `membership-discount` (158: the check
route through its own handler on the stand-in Whop with the real team check,
401 and 403, Whop's answer stored and the list read after it showing Approve
again, the code still there, Whop down, the write failing and every other
refusal in plain words; `saved` on `checkMembershipDiscount`'s answer; the
cron on 5 November reading a pending request of the shared group and one of a
canceled member from before 1 October, and failing when the pending requests
cannot be read), `admin-review` and `admin-render-fixes` (their 30% row
patterns and their count of `ReadFailure` follow the new source; the reason's
words are the second round's).

`admin-owner-review.test.mjs` (the owner's review of the preview,
2026-10-21; 58 checks) holds every rule that review added, run as the
source has it. The Dashboard: no source or explanation line under a
program or trend tile, the owner's list word for word and the Bounty
Program's per-day caption with it, the (i) definitions kept, the charts
taller (their heights read from the source); the Bounty Program's arrow by
`bountyTrend` (up when the last 14 days beat the 14 before, down when
fewer, none when equal, 0 and 0 too), `bounty`'s `previous14` counted to the
millisecond at both ends of the 14 UTC days before the window, and
`BountyArrow` from `DashboardView.tsx`, compiled with TypeScript into
`_gen/ow-*.mjs` with the parts it imports and rendered to a string: a green
up or a red down glyph hidden from a screen reader, its words for one ("Up
from 9 in the 14 days before") and the earlier count in its title. The 30%
page: `anywaySkip` and `approveAnywayText` for the coupon's row, the rule's
refusals and a refusal of the approve route (the confirm names what it
skips and claims nothing about what Whop does with two codes), Approve
anyway only for a founder or an admin (`ThirtyPage.tsx` hands the role),
a refusal with code "rule" remembered on its row, and no sentence above the
list when the coupons cannot be read. The approve route, copied here: the
new course's refusal and the old course's 409 "The course changed and this
check cannot run" carry code "rule" and `override` passes them; a decided
request carries no code. Applying: both request routes answer "We couldn't
check your membership just now. Try again in a minute." (503) and write
nothing when no Whop key is set and nothing is stored, and go in on a stored
answer. The survey: `unansweredRequired` on every kind of question (spaces,
a number as words, a field of the wrong kind, an empty choice, two answers
to one question), the form route refusing each unanswered case with
"Answer every question that is not marked Optional, then send it again."
before the database function is called, a failed read of the questions a
503 that writes nothing, a plain request refused while a required question
is active and let in when none is. With it changed: `membership-discount`
(170: Whop down, no membership and a payment's id at application time
refused and nothing written, the stored answer letting one in, Approve
anyway on the coupon's row with `override` and `overrideCoupon` and
`overrideCoupon` alone, and the helper's log saying "no answer is on file"),
`admin-discounts` (29: a csm's Generate anyway refused with no Whop code and
no OVERRIDE line, then an admin's made), `discount-double-submit` (33) and
`discount-september` (65), whose students now carry a stored answer for
their membership so Apply reaches the write, `admin-review` (98: its 30%
row patterns and the log's words), `admin-people` (78), and
`admin-render-fixes` and
`admin-render-second`, whose 30% row and journey card patterns follow the
new source.

T-122 (2026-10-21, `night/admin3`): every student a yes or a no. The
first live dry run of the coupon cron could not read 46 of 290 students (22
payment ids where the membership's belongs, 24 memberships with no plan or
no renewal price), and the request routes refuse every check that gives no
answer. `membership-discount` (255, +85) gives its stand-in Whop two more
reads: v2's `GET /api/v2/memberships?user_id=` (a user's memberships, in
pages of 50) and the pinned `GET /api/v1/payments?user_id=` (in pages by
cursor, newest first). It proves `judgeStudentDiscount` step by step: the
membership on file; a payment's id, no id, an id Whop does not know (404)
and another 4xx answered through the Whop user, of whose memberships the
order takes the active before the past due, then the newest, never another
product's or a canceled one, over two pages; a null renewal price, no plan
id and a plan Whop does not know judged by the newest real course payment
(87.30 a discount, 97.00 none; a $0, a refunded and another product's
payment left out; the code named), as is no course membership, and with no
payment at all no discount; a list that ignores the user filter, a 404 or
another shape handing over to the payment; no answer only for Whop down at
each step (no connection, a 5xx, a 429 three times, a hang past the answer
limit, a refused key, payments of another user or in another shape) and for
the deployment that cannot ask (no key, no course product, no Whop user),
the membership on file getting a 5xx never being asked about through the
user. Then `fetchLatestRealPayment` on its own (the older shape, a payment
naming no product, two pages, more than 10), `checkMembershipDiscount` with
`via` and the row's `source`, a database without v113 (the row refused with
`source` and written without it, once per run in the cron), both request
routes for each case with the student's line, a 200 or the 503, the approve
route, Check Whop again (200 through the user or the payment where it was a
422, the list read after it, 422 only with no Whop user, 500 with no course
product), the cron's `by_source`, `no_real_payment` and `failed` (only the
student Whop gave no answer for), and the data route counting a row stored
through the user for a student with a payment's id or none on file.
`admin-review` (100, +2) holds an Applied row with a payment's id or none as
"not checked yet" (Approve asks through the Whop user) and its stored row
counting, the Approved row's read still asking by the membership on file
alone, and the payment's-id check run on a stand-in fetch (it was logged and
never asked); `thirty-view` (98) `couponOf` with no membership id on file.

`first-payment.test.mjs` (the first-paid fix, 2026-10-20) proves where
`students.first_paid_at` comes from now: the student's first real Whop
payment (`src/lib/first-payment.ts`), not a membership date. The rule runs on
made-up payments in the shape `Api-Version-Date: 2026-10-15-1` gives (money
objects, `user: { id }`) and in the older bare-number shape: $0, a 100% promo,
a $1 plan, a full and a partial refund, a payment not yet paid, no `paid_at`,
no buyer. Both reads run on a stand-in `fetch` that pages
`GET /api/v1/payments` as Whop's v1 does: one user's (paging, another user's
row refused, a 429 waited out, every failure by its kind, the login's 2.5 s
deadline) and the walk of every paid payment (4 requests a second, the 240 s
start budget, the 285 s answer limit, a cursor given twice). Then the four
writers through their entry points: the webhook's `POST` (no `first_paid_at`
sent, a stored one kept), the login's `GET` (its first-payment read a stand-in
in `stub-server.ts`: a new student, the self-heal, a row the webhook made, a
stored date untouched, no payment, a failed, throwing or slow read, a value
written meanwhile), the 2-hour sync (`runWhopCommunitySync` with the real
`whop-members.ts` and `first-payment.ts` on the same `fetch`: no row of its
upsert names `first_paid_at`, and an empty row on the paying plan is filled
from the payment, only while empty) and the backfill route. For it
`stub-server.ts` gained `.not(column, "is", null)`, `.returns()`, the
`students` columns the sync reads (`discord_user_id`, `discord_username`,
`canceled_at`) and settable stand-ins for the login's self-heal lookup, join
date and first-payment read, whose defaults answer as before. Since the merge
into world-engine (2026-10-20) the `.not()` is the admin rebuild's (above),
which also takes `eq` and `like` and logs the filter as
`whop_user_id not is null`. The production
writers (`de9a077`) fail it: the webhook 4 checks, the login 11, the sync 9,
the backfill 5. 17 breaks of the rule and of the writers' guards each failed
it once. The review fix round (same day) added: a total that does not read
and a lost dispute, each left out and counted apart; Whop answering in
another shape (the buyer as a bare `user_id`, the total under another name,
served by the stand-in after it filters as Whop would) failing one user's
read, the walk, the sync's recovery and the backfill as `bad_page`, never
as "no payment"; the walk in 4 lanes, the stand-in taking `created_after`
and `created_before` as inclusive, as exclusive, ignoring them or refusing
them with a 400, on a history with 5 payments at each split: the same first
payments and counts as 1 lane, the lanes together at most 4 requests a
second, half the time or less with Whop at 1 s a page, and a 429 on one lane
pausing all of them; the sync's recovery read started at 239 s and never
answered, given up at 280 s with the `sync_runs` row written; and the
backfill in id order, its `after` cursor, no student started past 240 s and
no read waited on past 280 s.

`first-paid-repair.test.mjs` runs `POST /api/admin/first-paid-repair` (the
first-paid fix) through its own `POST`: the route, the run
(`src/lib/first-paid-repair.ts`), the walk on the same kind of stand-in
`fetch`, `discount.ts`'s dates and `requestCounts`, and the real team login
(401, and 403 for a CSM). 14 students cover the cases: the report's student
(5 September stored, 14 October paid), a buyer whose membership is 2 seconds
older than his payment, one moment written two ways, free members with and
without a date, empty rows, a first payment for another product before the
course's, a 100% promo, a full and a partial refund, a canceled student; and
four 30% requests: one that starts counting, one made after the launch, an
old approval beside the 30% its new date opens, and a rejected one. Dry
writes nothing; the snapshot lists exactly the rows the write changes, with
their stored values; the write moves the report's student to 14 October and
leaves every row with no payment as it was; a row changed between the read
and the write is left by the guard; a second write changes 0; a walk that does
not finish (Whop slow, a 401, three 429s) writes nothing and answers by 285 s;
writes due past 280 s are not started and the next write finishes them; no
answer or log line holds an email, a name or a Whop id. Its clock is the
suite's, as in `whop-catchup.test.mjs`. 13 breaks of the repair each failed it
once. The review fix round (same day) added, on the plan as a function, first
payments and stored dates exactly at 1 October and exactly at the launch
(and the millisecond before each), an applied request beside a 30% its new
date opens, and the student ids behind the counts that open the 30%; through
the route, those ids in the dry answer (`thirty_students`), the snapshot's
third column (`new_first_paid_at`), the oldest payment kept and Whop's time
per page, a walk out of time naming both and `"lanes": 4`, a dry run in 4
lanes giving the same counts as in 1, `lanes` other than 1 or 4 refused, a
Whop that ignores the lanes' dates and one that answers in another shape
writing nothing. 32 breaks of the round's code (the boundary and applied
mutations the review found, the shape guard, the two new skip kinds, the
lanes' guard, overlap, dedupe and shared pace, the sync's and the
backfill's time limits, the cursor) each failed this suite or
`first-payment.test.mjs`.

`whop-product-setting.test.mjs` (login-1 merged onto main, 2026-10-20) runs
production's `WHOP_PRODUCT_ID` exactly as the owner set it that day so that
Apex and ETfB members keep the app: three product ids (the course, ETfB for
brands, Apex team seats), no plan id. Four readers of it run on that value (a
fifth, `fetchWhopMembershipJoinDate`, a new student's `joined_at`, runs inside
the login's copy, and no check reads what it gives): the login's `GET`, from a
second copy of the callback (`whop-callback-route-real-whop.ts`) whose login
check (`checkActiveMembershipDiagnostic`, `whop.ts`) and self-heal
(`fetchActiveMembershipForUser`, `whop-members.ts`) are the real copies, once
with the company key's reads failing (the login check decides alone) and once
with the student's token getting the 404 legacy customers get (the self-heal
decides alone); the 2-hour sync (`runWhopCommunitySync`); and the webhook's
`POST`. A course member, an ETfB member and an Apex seat get in, get a row and
are written by the webhook; a member of a product the list does not name is
turned away with no row and no account, and the self-heal and the sync ask
Whop about the three products only. It also pins what the setting brings with
it: a member of another product whose row the old webhook wrote active still
gets in (the login asks the database first); the Apex seat and the ETfB member,
on plans outside `PAYING_WHOP_PLAN_IDS`, get no first payment from the sync;
and one order (same day; its review round the same evening) wherever one of a
user's memberships is picked: one that grants access, then active over
past_due (past_due locks the person out of the app), then the course's over an
ETfB or Apex one, then the newest. In the sync, with the course listed first
and then last: the course's membership over a newer ETfB one, the newer of two
Apex seats and of two course memberships, a valid seat over a canceled course
membership, an older active seat over a newer past_due course membership (and
the mirror, an active course membership over a newer past_due seat), the
course over a newer ETfB membership when both are past_due, and an older
active course membership over a newer past_due one. In the webhook: an Apex or
ETfB activation and an ETfB payment leave a course student's active row as it
is, with Whop not asked, and over a row past_due on the course they write the
seat or ETfB membership, active, with its own id and plan (a payment's
membership, never its `pay_` id). With no product in the payload: a past_due
seat, the only membership Whop lists, leaves an active row and a past_due row
as they are; an event whose own id is the course membership the row is on
does not move the row onto a seat Whop lists alone; the lookup picks an active
seat over a past_due course membership, and the course over a seat listed
before it (for a row and for no row). A failed read of the row answers 500; a
lapsed row, a row already on the event's membership (a payment's membership
too, and a row an earlier delivery of the same payment stamped with its `pay_`
id) and a user with no row are still written, and the course's own activation
and payment still point a row on a seat (active or past_due) at the course.
The webhook's re-point after a membership ends: the course membership ending
re-points the row at an active seat (also past a past_due ETfB membership
listed first), a seat ending re-points it at the course membership (past a
newer seat listed first), and one of two seats ending leaves it on the course.
The login's self-heal, in each of its three reads (the user's memberships,
each listed product's, the member; the stand-in's `down.byUser` and
`down.byProduct` fail the reads before), lets a student with no row in on the
course membership when a seat is listed first, and on the seat when the
course membership listed first is past_due; the calls show which read decided.
`isEtfbOrApexProduct`'s two ids are checked against `whop-products.ts`'s
(admin rebuild 2 moved them there from `etfb.ts` with the same values, and the
merge into `night/preview-2026-10-21` pointed the check there). For it
`stub-server.ts` gained `students.whop_membership_id`, which the webhook reads
before an ETfB or Apex event writes (admin rebuild 2 had added the column for
its loaders; the merge keeps the one). Ten breaks (each reader taking any product
or only the first id, the sync's dedupe turned around, the webhook or the sync
writing `first_paid_at` again) each failed it at the merge. 13 breaks of the
course rule each failed it at its first round (8d213e7): in the sync, the rule
dropped, decided before access, and recency turned around within a kind; in
`isEtfbOrApexProduct`, an id mistyped and a missing product taken for ETfB or
Apex; in the webhook, the check dropped on an activation or on a payment, keyed
on the payload's product, past_due not counted, a row on the event's own
membership or a user with no row left unwritten, a payment's membership not
read, and a failed read writing anyway. The review round's 19 breaks each fail
it, `whop-webhook-product.test.mjs` or `first-payment.test.mjs`: in the order,
step (b) dropped, the course put before it, the course rule dropped, recency
turned around, and past_due ranked as no access; in the lookup, the first
membership that grants access taken, its second read taking the first listed
product's, and its product check and its access check dropped; in the
webhook's check, the status rule of the first round, an active write taking
an active row, the event's own ids compared when the payload names no
product, and left out when it names one, a named event taken for one the
lookup found, and the check dropped on a payment or an activation; a payment
writing its own `pay_` id, and `membership_id` read before `membership.id` or
the bare `membership` before `membership_id`. The course alone in
`WHOP_PRODUCT_ID` fails 43 of its 78 checks (30 of 52 before the round).

The order's second review (the same evening, of d1979df) takes it to 104 checks. The
webhook: a membership ending while no read of Whop answers writes nothing and
answers 500 (`lookUpActiveMembershipForUser` says `everyReadFailed`), for an
Apex seat or an ETfB membership beside the course membership the row is on,
the seat the row is on, the course membership the row is on beside an active
seat, and the second read failing for the course alone with the first and the
third failing; sent again once Whop answers, the row stays on the course.
When Whop answers with nothing that grants access, a row on another
membership is left for the sync whatever the product (an Apex seat, an ETfB
membership, another course membership, the course membership beside a row on
a seat), the row on the membership that ended is canceled with the write
keyed on that membership, and a failed read of the row answers 500. The
lookup: which failing reads make `everyReadFailed` (a member with no
memberships list is no answer, and neither is a second read with one product
failing); the course's read failing hands over to the third read, which gives
the course membership where the other products' rows gave a newer seat; rows
naming no product take the product their read asked for; a tie keeps the one
seen first. The sync: a canceled course membership older than a canceled seat
leaves the row on the seat (as built: between two that grant no access only
the date decides), and a tie keeps the one seen first. The stand-in fetch
gained `down.oneProduct`, `down.member` and `listedUnder`. Five checks of
`whop-webhook-product.test.mjs` (now 34) and `whop-webhook-old-rows.test.mjs`
(now 19) changed with it: a deactivation with no product and Whop failing
answers 500 (it answered 200); Whop failing on the row an Apex seat made
answers 500 and the event sent again cancels it (it canceled at once); a
second course product's membership ending cancels a row on it and leaves a
row on another membership; the course's own membership ending reads and
cancels the row by that membership too (it was keyed on the student alone);
and the row moving while Whop is asked is tested with Whop answering nothing.
On the route and lookup of d1979df the three suites fail 16 of 104 (the new
lookup's name pointed at the old lookup, which never says `everyReadFailed`),
2 of 34 and 2 of 19. 14 breaks
each fail at least one of them: the lookup never saying `everyReadFailed`, the
route ignoring it, nothing found leaving only a row of an event with no
product, the row read only for a product outside the list, the cancel keyed
on the student alone, the first read not counted as an answer, a member with
no list counted, a second read with a failed product counted, the second read
as before (a failed product skipped, a pick from the rest), the second read
picking from what it had before the failure, the course rule applied between
two that grant no access, a tie keeping the one seen last, a row naming no
product classified without its read's product, and a course row logged as one
the old webhook made. The course alone in `WHOP_PRODUCT_ID` fails 53 of the
104.

`stub-call-gate.ts` reimplements the real gate's interval logic (minus its
telemetry fetch, which needs a network), so the interaction between the
heartbeat and the gate is genuinely exercised rather than stubbed away.

`Date.now` is monkeypatched so 12 minutes of playback runs in milliseconds, and
`playFor()` simulates a player reporting ~3.7 times a second **and yields to
the event loop between ticks** — without that, in-flight requests never resolve
and the test measures a situation that cannot happen in a browser. 3.7 a second
was the first player's measured rate, and sections 1 to 9 keep it so their
assertions stand as written. Sections 10 to 17 were added for Tella's player,
which reports every 250 ms: they use the steps measured on it at 1x, 2x and
2.5x and hand the heartbeat its own `rpc` and clock (one control in section 16
leaves the `rpc` out on purpose).

`lesson-rating.test.mjs` (admin rebuild 2, WI-7, 2026-10-20) proves who can
rate which lesson and what a rating may hold. The rule
(`src/lib/world/lesson-rating.ts`, copied untouched) runs over a plain video
lesson, a video action item, a setup step and the Ad Bounty lesson, each with
no completion row, the video watched, the hand-in only, both, a skip only and
a skip after watching, against `isLessonComplete` from the real `progress.ts`:
only a video lesson that is not the Ad Bounty's, watched and done, can be
rated. The body: stars whole from 1 to 5 (0, 6, 4.5, "4" and NaN refused,
never rounded), a comment of 1000 characters once trimmed allowed and 1001
refused, never cut. Then `POST /api/student/rate-lesson` through its handler,
with the real closed doors' gate, on `stub-server.ts`'s database (which gained
`lessons.feature_key` and a `student_lesson_ratings` table with its unique
key): 401 without a token, 503 while the app is closed, the upsert on student
and lesson writing only the token's student, every refusal with its sentence
and code and nothing written, the live `lessons` and never `lessons_next`, and
each failed read or save a 500 in plain words with the database's words in the
log only. Five changes to the route's copy (done always true, watched always
true, `lessons_next`, read errors ignored, a 400 for "not finished") each fail
it.

`lesson-feedback.test.mjs` (the same lane) proves the team's Lesson feedback
below its page: `buildLessonFeedback` groups made-up ratings by area in route
order and lesson in course order, averages and counts them, lists comments
newest first by when they were last saved (blank ones left out), lists every
video lesson and any other lesson that has a rating, and counts a rating for a
lesson the catalog lacks as `unplaced`. `loadLessonFeedback` reads only the
ratings since `curriculum_reset_at` (all of them with no switch), 2,350 of them
in 3 pages past the 1000-row cap with none twice, the raters in batches of 100
ids, and fails, naming the read, when any of its five reads fails or the switch
row is not a date. `GET /api/admin/lesson-feedback` runs over the real
`admin-auth.ts`: 401, 403 for a student and a csm, 200 for a founder and an
admin with exactly the builder's answer, and a failed read in words. It also
checks the page's frame: `/admin/feedback/lessons` is in `REBUILT_PAGES`, the
csm gate, no database call in the view, and the view's words.

`student-context.test.mjs` gained a section on `rateLesson` in the same lane:
the saved row reaches `lessonRatings` only when the route saves it, a refusal
and a dead connection come back as sentences with nothing shown as saved, and a
read taken before a save and answered after it does not take the saved rating
off the lesson page (with the guard taken out, that check fails).

## What it caught

Worth recording, because none of it was visible by reading the code:

1. **Forced writes were silently dropped.** A beat requested while another was
   in flight was discarded. The beat most likely to hit that window is the
   forced one on pause or tab-hide — the write whose entire job is recording
   the final position. Now queued.
2. **Queueing them then doubled the write count**, 100 instead of 50 per
   lesson: the ~0.27s of playback that accrues during the in-flight window
   reads as "something changed", so every write immediately drew another. Only
   *forced* beats are queued now; a throttled one that arrives mid-flight is
   dropped, because the next tick is 270ms away and re-checks the throttle.
3. **A refused beat caused a retry storm.** `lastWriteAt` was only moved on an
   accepted write, so a server-side rate-limit refusal left the client's
   throttle satisfied and it retried on the very next tick — roughly a dozen
   calls in the 5 seconds the server was refusing. `lastWriteAt` now moves on
   any completed round trip; the delta stays banked, so nothing is lost.

It also surfaced that the **first timeupdate writes immediately** rather than
15s in. That was accidental, and it is kept on purpose: the player emits no
timeupdate until playback truly starts, so that beat creates the row and stamps
`first_played_at` at the real moment the student pressed play. It costs one
write and makes "did they even start this lesson" answerable for someone who
leaves after ten seconds.

## Limitation, stated plainly

A forced write during `pagehide` is **best-effort**. supabase-js uses `fetch`
without `keepalive`, and a browser may cancel an in-flight request as the page
goes away. The 15s throttle is what actually bounds the loss: a student who
closes the tab loses at most 15 seconds of position, which is the design, not
a bug this can fix.
