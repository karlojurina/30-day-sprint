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

The run ends with `PASS 514   FAIL 0` (312 before the cutover sections).

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
  does, not that they filter correctly at runtime.
- Supabase-specific pieces (`auth.uid()`, `current_user_is_team()`) are test
  seams backed by `set_config`, not the real implementations.
- It does not prove anything about the *data* in production, only about the
  SQL's behaviour against a faithful schema.
- PGlite is one session, so **no lock is ever waited on**. A second session
  holding a table cannot be staged (a prepared transaction would hold one,
  and the wait for it hangs the WASM build, `lock_timeout` never fires). The
  cutover's lock is proved by which tables it locks and when, and its
  timeout sentence by raising 55P03 in place of the lock.
