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

## How it stays honest

The pre-migration objects are **lifted verbatim out of the real migration
files** at runtime (`lift()` in `run.mjs`) rather than retyped here. If v81's
view is retyped by hand and gets subtly wrong, the test passes against a
fiction. Extracting the real text means the "before" state is the real one.

`base.sql` is the exception: it is a hand-written minimum of the table shapes
the migrations touch, assembled from v3 + v6 + v15 + v19 + v22 + v27 + v31 +
v32 + v77. It is **not** a full copy of production and is not meant to be —
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
