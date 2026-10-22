# Migration tests

Migrations in this project are **hand-run by Lovro in the Supabase SQL editor**.
There is no CLI, no migration ledger, and no staging database — a file either
works the first time it is pasted into production, or it doesn't.

This harness is the dry run that setup otherwise doesn't have. It boots a real
Postgres (PGlite — Postgres compiled to WASM, no Docker, no server), rebuilds
the parts of production that a migration touches, runs the migration, and
asserts that the things which must not move did not move.

## Run it

```bash
cd 30-day-sprint/supabase/migration-tests
npm install      # once
npm test
```

Exit code 0 = every assertion passed. Failures print first and last.

`npm test` runs `run.mjs`, then `v111.test.mjs` (v111 and its undo, admin
rebuild 2, D5, in a file of its own so the lanes that added v109 and v110
to `run.mjs` merged without touching it), then `v113.test.mjs` (v113 and
its undo, T-122: `student_membership_discounts.source`, the step of the
coupon check that answered, since T-122's fifth fix round THE RULE STAMP,
the rule's version and the step (`r5-membership`, `r5-user`,
`r5-payment`), with `source_checked_at`, the `checked_at` of the write that
set it; a row carrying them refused before v113, pasted twice, only this
rule's three values or empty, an earlier round's words (`membership`,
`user`, `payment`) refused and emptied from a database that holds the
earlier copy of the file, the older builds' writes made as PostgREST makes
them, an earlier round's refused whole and one from before T-122 keeping the
stamp with a new `checked_at`, the undo dropping both columns and keeping
every row, and v113 on a database without v111). On `night/admin2` with the
5 lanes merged: `PASS 702   FAIL 0`, then `PASS 22   FAIL 0`. On
`night/admin3` for T-122: `PASS 702   FAIL 0`, `PASS 22   FAIL 0`, then
`PASS 23   FAIL 0`; for its fifth fix round (2026-10-22): `PASS 702   FAIL
0`, `PASS 22   FAIL 0`, then `PASS 34   FAIL 0`.

## What it actually checks

The interesting assertions are the ones about things **staying the same**:

- `student_progress_counts.completed_count` is still `integer` and
  `achievement_unlock_stats.unlocked_count` is still `bigint`.
  `CREATE OR REPLACE VIEW` cannot change a column's type, so getting either
  backwards aborts the whole file. These two need **opposite** treatment —
  one keeps its `::int` cast, the other must never be cast.
- `security_invoker` is still `on` for the two student views and still
  `false` for `achievement_unlock_stats` (deliberate, see the v78 header).
- Every row of `student_progress_counts` and `student_current_region` is
  byte-identical before and after, and the snapshot RPC returns the same
  numbers. A migration that "works" but quietly moves a student's progress
  is the failure mode this project keeps hitting.
- Re-running each file changes nothing (they are hand-run; re-runs happen).
- The `_next` staging catalog does not touch the live `lessons` table.
- The heartbeat RPC against a hostile client: forged deltas, replayed calls,
  positions past the end, scrubbing backwards, calls with no session.
- Section 20, the course catalog (v101): the generated migration and its undo match `supabase/catalog/course_catalog.json`, the 141 lessons replace the placeholder seed and can be put back, and the file refuses to retitle or remove a lesson that a video row or a watch row points at.
- Section 21, the video load (`diagnostics/load-lesson-videos.sql`): filled with made-up ids, it makes `lesson_videos` and the lengths follow a list and refuses every bad list with nothing changed. `LESSON_VIDEOS_SQL=/path/to/the/filled/copy npm test` also runs the private file of real rows and prints counts only.
- Section 22, the text load (`diagnostics/load-lesson-text.sql`): filled with made-up texts, it makes `description` on the course's lessons follow a list (a text round-trips byte for byte, a lesson dropped from the list gets null, a live lesson like l004 keeps its own) and refuses every bad list with nothing changed. `LESSON_TEXT_SQL=/path/to/the/filled/copy npm test` also runs the private file of real texts on a database of its own and prints counts only.
- Section 23, the cutover's expand (v103 and its undo): the four objects are there, the progress views and the snapshot numbers do not move, a second run changes nothing, the new view gives the latest counted lesson, at the later of its completed_at and action_completed_at (no row for a skip only or a half-done compound lesson), and the undo puts every object and row back and refuses while the switch is in place. The snapshot floor: with no `curriculum_reset_at` every write goes through as before; with it, a rebuild, update, delete or insert of a day before the switch raises 22023 and changes nothing, and the switch day itself is still written.
- Section 24, the switch (v104 and its undo, `diagnostics/cutover-preflight.sql`, `cutover-postcheck.sql`, `admin-health.sql` INVARIANT 6): one copy of the database per broken starting point, each refused with its sentence and nothing changed; the first run's archive, stamps, CSM changes, wipe, copy, RESTRICT keys and Whop index, each against counts worked out separately before the run; the app's own SQL afterwards (views, snapshot RPC, heartbeat); a second run and v101 both change nothing; the undo moves new-course progress into `archive_v2` and puts every table, constraint, not-null and index back as the dump before the switch had it (except the first logins the switch filled in, which stay, and a task note the team changed after the switch, which is kept); the switch runs again after it; the undo's three refusals. The lock: v104 and its undo each lock, before their first read and with `lock_timeout` 5s, exactly the 18 tables their own statements write or alter (read from `pg_locks` on a run with the lock taken out), and a timeout in place of the lock stops with "Nothing was changed. Paste it again in a minute." v103 runs with `lock_timeout` 5s.
- Sections 23 and 24 run twice: on this harness's database as section 22 leaves it, then on a second database built from `base.sql` and the real migration files v92 to v101 in order. `base.sql` carries the tables the switch touches for that (lesson_notes, ratings, the quiz tables, templates, tasks, alerts, `student_whop_sync`), shaped from the migrations named beside each, with Postgres's default key names as in production.

- Section 25, v105 and its undo, and `diagnostics/backend-readiness-read.sql`: on a database of its own (base.sql and the chain v92 to v101) with the policies production has on `student_lesson_completions`, `discount_requests` and `student_achievements`, lifted verbatim from v3, schema.sql, the team_members recursion fix, v53 and v55, and the feedback form's tables and function from v29. What a student's session could send is run for real under `SET ROLE authenticated`: before v105 a student writes their own completions, an "approved" discount request and a badge; after it every such write is refused (42501) while their reads, the service role, the team's policies and the feedback form's function work as before. The record v105 keeps, the undo putting back every policy exactly (command, roles, using, check, comment) with nothing else in the database different, a second run of each, the lock and its timeout, five refusals, and base.sql's spelling of the student policy. The read runs, changes nothing, and its part a shows the back doors before v105 and none after.
- Section 26, v106 and its undo (T-057): with two students holding two pending requests it adds nothing, lists them and does not fail; once they are decided it adds the unique index, and a second pending request is refused (23505) whether inserted or set back to pending; other states are not limited; a second run, a wrong index of the same name, the hold on the table and its timeout, the undo. Then v103 and the switch (v104) still run after v105 and v106. Since T-080 it also runs the real v29 function for a student holding a request from before the launch (pending, approved and applied refused, rejected written), on its own copy with v21 applied first.
- Section 27, v107 and its undo (2026-10-17): on section 26's database, with `auth.role()` as Supabase defines it (the role in the request's token). Before v107 a student's own session writes a pending request through v29's `submit_discount_with_feedback` and the service role is refused. After it a student and a visitor are refused before the function runs (42501), the service role writes the request and its answer, v29's duplicate check and inserts are kept word for word, a regrant to `authenticated` still meets the function's own refusal, and a call from the SQL editor (no request token) is refused. The three answers of T-090's check after the paste: the service role's call for a student id no row has fails on the foreign key (23503), with no service_role in its token the function refuses it (P0001), and as another role it gets 42501. A second run and v105 pasted again change nothing; it refuses with the function or `auth.role()` missing; the undo puts v29's function back exactly (pg_get_functiondef as before), and v107 applies again after it.
- Section 28, `diagnostics/whop-sync-proof.sql` (2026-10-19, Lovro's preview review: two lessons finished on Whop that the app never showed): on a database of its own (`chainDatabase`). Before the switch the lookup the webhook and the backfill run (`lessons` by `whop_lesson_id`) finds neither a1l01 nor a1l02, and a completion of a1l01 is refused by the key into `lessons` (23503); after v103 and v104 the same lookup finds both by the catalog's Whop lesson ids. The read runs before and after v104, changes no row, and each part reads as its header says: no account, two accounts, no check yet, the last check in Croatia time and what Whop gave it, "before the switch", each unmatched Whop id placed in the new course, a completion later than the last check, and the note and the error each with its time.

- Section 29, v108 and its undo (bug hunt of 19 October, cron-3): on two databases of its own (base.sql and v55's function and comment lifted verbatim), one with Supabase's default privileges on functions and one bare. Before v108 a visitor (anon) and a student can each write another student's quiz row with one call. After it both are refused (42501) and the service role still calls it: on Supabase it keeps its own grant, and where it held EXECUTE through public it now holds it directly. The function's body, comment and owner, every other grant and every row are unchanged; a second run changes nothing. The undo drops the function and makes it again from v55's own text, which puts the ACL back byte for byte in both databases (a grant line cannot: with one in its place this section fails), a second undo changes nothing, and v108 applies again after it. With the function gone v108 changes nothing and says so; with anon missing it refuses.
- Section 30, `diagnostics/admin-today-spotcheck.sql` (2026-10-20, the admin rebuild's spot check for Lovro at its ship step): on a database of its own (`chainDatabase`), after v103 and v104, with made-up members. The file is one select with no placeholder, runs the way the SQL editor runs it, changes no row, and picks 5 members, each once, only from the ones Today lists from (active or past due, a Whop membership, not exempt): over 40 runs all 7 such members turn up, and never a canceled, expired, exempt, status-less or no-Whop-membership one. Every row equals the row worked out in the test: `lesson_is_complete()` and the two views' rules written again in JavaScript, the 30% rule with its dates and its 14 days read from `src/lib/world/discount.ts` and `src/lib/constants.ts`, the plan ids read from `constants.ts` (the yearly two from its comment since admin rebuild 2's review fix round removed `src/lib/admin/plans.ts`; a yearly id gone from it fails the section), the dates in Croatia time through Intl. Members sit on each edge: a first payment at 00:30 on 1 October in Croatia (shared deadline) and one a minute before (none), one at midnight starting 9 October (its own 14 days, ending at 00:00 on Fri 23 Oct) and one a minute before (shared), 14 days that end after the clocks go back (Mon 26 Oct, 10:15), a lesson with no video (not asked for), a skip (no video), a hand-in still open (a video, no lesson), a lesson past the checkpoint and the Ad Bounty lesson. The same 5 read the same with the session in UTC, Europe/Zagreb and America/New_York. Eight mutations of the file (14 calendar days for the 336 hours, the first day in UTC, a skip counted, a lesson with no video asked for, exempt or past-due members, a zero-padded day, the first payment read in UTC) each fail it.
- Section 31, v109 and its undo (admin rebuild 2, D7, the tasks reset): on a database of its own (base.sql with v27's one open task per student and scenario lifted verbatim), with made-up tasks in every state. v109 holds `tasks` in SHARE ROW EXCLUSIVE before it reads, with `lock_timeout` 5s, and a timeout stops it with nothing changed. Its first run copies the 5 open tasks (a cron's, a custom template's, an exempt student's, one with no template) into `archive_tasks.reset_2026_10`, every column as it was plus `reset_at`, dismisses them at the run's moment by nobody with " [reset for the new program]" after their notes, and writes `admin_config.tasks_reset_at`; the sent and dismissed tasks, every other table and every grant do not move, and only the owner reads the copy. A second run changes nothing. After a cron opens one scenario again and the team changes two reset tasks, the undo puts back the two nobody touched byte for byte, leaves the other three as they are now and counts why, takes the moment out and renames the copy; a second undo changes nothing, v109 runs again after it, and both refuse on a copy that is missing, from another moment or left behind.
- Section 32, v110 and its undo (admin rebuild 2, WI-7, 2026-10-20): on a database of its own (`chainDatabase`) with section 25's Supabase seam and v75's trigger, row level security and four policies on `student_lesson_ratings` lifted verbatim. Before v110 a student's own session rates a lesson they never finished and rewrites a rating with a 5000-character comment (never another student's). v110 holds the table in ACCESS EXCLUSIVE before it reads anything, with `lock_timeout` 5s, and its timeout says "Nothing was changed. Paste it again in a minute."; it refuses with row level security off, the table missing, or a third write policy (named), changing nothing. Its first run drops the two student write policies and leaves the student's and the team's SELECT and everything else character for character; after it a student's insert and upsert are refused (42501) and their update and delete touch no row, while they still read their own ratings, the team reads all and the service role's upsert works with v75's trigger moving `updated_at`. A second run changes nothing; the undo, made from v75's own text, puts the four policies back exactly and nothing else differs; a second undo changes nothing and v110 applies again. 25 checks.

The run ends with `PASS 702   FAIL 0` (312 before the cutover sections, 514 before sections 25 and 26, 566 before section 27, 584 before section 28, 606 before section 29, 634 before section 30, 649 before section 31, 677 before section 32).

## How it stays honest

The pre-migration objects are **lifted verbatim out of the real migration
files** at runtime (`lift()` in `run.mjs`) rather than retyped here. If v81's
view is retyped by hand and gets subtly wrong, the test passes against a
fiction. Extracting the real text means the "before" state is the real one.

`base.sql` is the exception: it is a hand-written minimum of the table shapes
the migrations touch, assembled from v3 + v6 + v15 + v19 + v22 + v27 + v31 +
v32 + v77, and for the cutover v2 + v10 + v34 + v46 + v51 + v54 + v57 + v65 +
v75 + v85. It is **not** a full copy of production and is not meant to be —
the live preconditions are verified separately by
`../diagnostics/prd1-preconditions.sql`, which Lovro runs against the real
database. This harness proves the new SQL is correct *given* those
preconditions.

## Adding a migration

Append a section to `run.mjs`: run the file with `exec()`, then `note()` each
assertion. Put the "what must not move" checks in first — those are the ones
that catch real breakage. The cutover files (v97/v98) are the ones this was
built for; test them here before they are ever pasted anywhere.

## Limitations, stated plainly

- PGlite runs as a single superuser, so **RLS row filtering is not exercised**
  — the harness asserts that the right policies exist and that no write policy
  does, not that they filter correctly at runtime. Sections 25 and 26 are the
  exception: they switch to the API roles with `SET ROLE` (authenticated,
  service_role with BYPASSRLS, as on Supabase), so the policies filter for
  real there. The feedback form's function is owned by PGlite's superuser
  there; on production its owner is checked by v105 itself.
- Supabase-specific pieces (`auth.uid()`, `current_user_is_team()`) are test
  seams backed by `set_config`, not the real implementations.
- It does not prove anything about the *data* in production, only about the
  SQL's behaviour against a faithful schema.
- PGlite is one session, so **no lock is ever waited on**. A second session
  holding a table cannot be staged (a prepared transaction would hold one,
  and the wait for it hangs the WASM build, `lock_timeout` never fires). The
  cutover's lock is proved by which tables it locks and when, and its
  timeout sentence by raising 55P03 in place of the lock.
