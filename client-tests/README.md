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
stops the build.

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
past-due canceling students): each run now stops with a 500, cron_runs failed
and nothing written, where the copy from 70c934a wrote wrong tasks, alerts or
dismissals and said success. With 250 students the pool-wide reads go out
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
zoom into them, and 13px and 15px with a mouse, as before. On 2026-10-20 the
same two files were also loaded into headless Chrome with touch emulation and
read back the same sizes (13px and 15px on touch before the fix).

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
