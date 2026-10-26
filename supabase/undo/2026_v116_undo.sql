-- ============================================================
-- UNDO for v116 (supabase/migrations/2026_v116_discount_request_history.sql)
--
-- Redeploy the build from before this one, then run this file: the code
-- writes the columns it drops. With the build of v116 still live, each of
-- its writes that names an actor fails on the missing columns and its
-- events find no table: the app makes and attaches no code, its Approve and
-- Reject fail, and its job's runs fail (a student's request is still
-- written, and waits).
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v116 back.
--
-- WHAT IT DOES
--   0. Before its transaction, empties the settings its last row reads, so a
--      run that stops says "did not finish" even in a session where an
--      earlier run finished.
--   Then, in one transaction:
--   1. Locks discount_requests, then discount_request_events when it is
--      there, in ACCESS EXCLUSIVE mode, as v116 does, each lock waiting 5
--      seconds at most.
--   2. Drops the trigger discount_request_history and its function: from
--      then on a change of a request is recorded nowhere, as before v116.
--   3. Keeps the history. discount_request_events is renamed to the first
--      free name of discount_request_events_v116_undone,
--      discount_request_events_v116_undone_2, _3 and so on (an earlier undo
--      may have taken the first), and its index, primary key, identity
--      sequence and constraints are renamed with it (..._request_idx,
--      ..._pkey, ..._id_seq, ..._event_check and the rest), so a v116 pasted
--      again makes its own under the names it had. Its rows, its policy and
--      its grants go with it: the team still reads it, and a row still goes
--      with its request or its student.
--   4. Drops the four columns v116 added to discount_requests. The three
--      audit columns are empty at rest; the time of each claim
--      (promo_claimed_at) is lost with its column.
--   5. Commits, and shows one row.
--
-- WHAT CHANGES FOR ANYONE
--   With the build from before v116 live: nothing anyone sees.
--   discount_requests is as it was before v116, row for row but the four
--   columns.
--
-- WHEN A TABLE IS BUSY
--   Another session holding discount_requests or discount_request_events
--   for more than 5 seconds stops it with "Another session held ... for
--   more than 5 seconds (...), so the v116 undo did not start. Nothing was
--   changed. Paste it again in a minute." While it runs (well under a
--   second) reads and writes of discount_requests wait for it.
--
-- Safe to run again: with the trigger, its function, the table and the
-- columns gone, it changes nothing and says so. v116 can run again after
-- it: it makes a new, empty discount_request_events beside the kept one.
-- ============================================================

-- ─────────────── 0. What the row at the end reads ───────────────

select set_config('v116undo.ran', 'no', false), set_config('v116undo.kept', '', false),
       set_config('v116undo.kept_events', '', false);

begin;

set local search_path = public;
set local lock_timeout = '5s';

-- ─────────────── 1. The locks ───────────────

do $lock$
declare
  v_table text := 'public.discount_requests';
begin
  if to_regclass('public.discount_requests') is not null then
    lock table public.discount_requests in access exclusive mode;
  end if;
  v_table := 'public.discount_request_events';
  if to_regclass('public.discount_request_events') is not null then
    lock table public.discount_request_events in access exclusive mode;
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held % for more than 5 seconds (%), so the v116 undo did not start. Nothing was changed. Paste it again in a minute.', v_table, sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 2 to 4. The trigger, the history, the columns ───────────────

do $undo$
declare
  c_table constant text := 'discount_request_events';
  v_kept  text;
  v_n     int := 1;
  v_seq   text;
  r       record;
begin
  -- 2. The trigger and its function.
  if to_regclass('public.discount_requests') is not null then
    drop trigger if exists discount_request_history on public.discount_requests;
  end if;
  drop function if exists public.discount_request_history();

  -- 3. The history, kept under the first free name.
  if to_regclass('public.' || c_table) is not null then
    loop
      v_kept := c_table || '_v116_undone' || case when v_n = 1 then '' else '_' || v_n end;
      exit when to_regclass('public.' || v_kept) is null
            and to_regclass('public.' || v_kept || '_request_idx') is null
            and to_regclass('public.' || v_kept || '_pkey') is null
            and to_regclass('public.' || v_kept || '_id_seq') is null;
      v_n := v_n + 1;
    end loop;

    perform set_config('v116undo.kept_events', (select count(*) from public.discount_request_events)::text, false);

    -- Its constraints (the primary key renames its index with it).
    for r in select c.conname::text as conname
               from pg_constraint c
              where c.conrelid = ('public.' || c_table)::regclass
                and c.conname::text like c_table || '\_%'
              order by c.conname loop
      execute format('alter table public.%I rename constraint %I to %I',
                     c_table, r.conname, v_kept || substr(r.conname, length(c_table) + 1));
    end loop;
    -- Its own index.
    if to_regclass('public.' || c_table || '_request_idx') is not null then
      execute format('alter index public.%I rename to %I', c_table || '_request_idx', v_kept || '_request_idx');
    end if;
    -- Its identity sequence.
    v_seq := pg_get_serial_sequence('public.' || c_table, 'id');
    if v_seq is not null then
      execute format('alter sequence %s rename to %I', v_seq, v_kept || '_id_seq');
    end if;
    execute format('alter table public.%I rename to %I', c_table, v_kept);
    perform set_config('v116undo.kept', v_kept, false);
  end if;

  -- 4. The four columns.
  if to_regclass('public.discount_requests') is not null then
    alter table public.discount_requests
      drop column if exists audit_actor,
      drop column if exists audit_correlation_id,
      drop column if exists audit_team_member_id,
      drop column if exists promo_claimed_at;
  end if;

  perform set_config('v116undo.ran', 'yes', false);
end
$undo$;

commit;

-- ─────────────── What is there now ───────────────

select case
         when current_setting('v116undo.ran', true) is distinct from 'yes'
           then 'The v116 undo did not finish in this session. Nothing was changed.'
         when nullif(current_setting('v116undo.kept', true), '') is not null
           then 'The v116 undo ran now: the history is kept as ' || current_setting('v116undo.kept', true)
                || ' (' || current_setting('v116undo.kept_events', true) || ' events), and the trigger and the four columns are gone.'
         else 'Nothing of v116 was left to undo. This run changed nothing.'
       end as v116_undo,
       nullif(current_setting('v116undo.kept', true), '') as history_kept_as,
       nullif(current_setting('v116undo.kept_events', true), '')::int as events_kept,
       (select count(*)::int
          from pg_trigger
         where tgrelid = to_regclass('public.discount_requests')
           and tgname = 'discount_request_history') as trigger_left,
       to_regprocedure('public.discount_request_history()') is not null as function_left,
       to_regclass('public.discount_request_events') is not null as events_table_left,
       (select count(*)::int
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'discount_requests'
           and column_name in ('audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at')) as columns_left;
-- EXPECT one row. The first run: "The v116 undo ran now: the history is kept
-- as discount_request_events_v116_undone (N events) ...", history_kept_as
-- that name (discount_request_events_v116_undone_2 and so on when an earlier
-- undo took it), events_kept N, trigger_left 0, function_left false,
-- events_table_left false, columns_left 0. A second run: "Nothing of v116
-- was left to undo. This run changed nothing.", history_kept_as and
-- events_kept empty, the rest the same. If the file stopped with a message
-- ending "Nothing was changed.", it is true: everything after the first
-- select is one transaction, and that select only empties this session's
-- three settings.
