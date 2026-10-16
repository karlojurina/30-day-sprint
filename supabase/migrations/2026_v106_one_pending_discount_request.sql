-- ============================================================
-- v106: one pending discount request per student (T-057).
--
-- THE PROBLEM
--   Nothing in the database stops a student having two pending requests.
--   Two Apply clicks at the same moment both pass the request route's check
--   (src/app/api/discounts/request/route.ts) and insert two rows. Approving
--   the second then fails on Whop's duplicate promo code, so it stays
--   pending forever. Older than the new course; found by the independent
--   review of 14 October. It does not depend on the course switch.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Holds discount_requests against writes, waiting 5 seconds at most to
--      get it, so no request lands between the look in step 2 and the index.
--      Reads go on; a request made in that moment waits, well under a second.
--   2. Looks for students who already have more than one pending request.
--   3. None: adds the unique index discount_requests_one_pending_per_student
--      on discount_requests (student_id) where status = 'pending'. From then
--      on the database refuses a second pending request for a student
--      (SQLSTATE 23505), and the first one stands. Approved, applied and
--      rejected requests are not limited.
--      Some: adds nothing, does not fail, and lists every pending request of
--      those students. Nothing was changed. Keep the newest pending request
--      of each student listed and reject the older ones in /admin/discounts
--      (the map and the old dashboard both show a student their newest
--      request), then paste this file again.
--   4. Shows what it did.
--
-- WHAT A STUDENT NOTICES
--   Nothing, normally. On a double click the second request is refused: the
--   request route answers "Failed to create request", and the feedback
--   form's function raises the database's own words. The first request is
--   pending either way, and the map shows it at its next load.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * discount_requests is missing.
--   * An index named discount_requests_one_pending_per_student exists and
--     is not this one, or is not valid. The message shows it.
--
-- WHEN THE TABLE IS BUSY
--   Another session writes discount_requests for more than 5 seconds:
--   "Another session held discount_requests for more than 5 seconds (...),
--   so v106 did not start. Nothing was changed. Paste it again in a minute."
--
-- UNDO: supabase/undo/2026_v106_undo.sql drops the index.
--
-- Re-runnable: run again, it finds the index, changes nothing, and says so.
-- ============================================================

begin;

-- ─────────────── The hold ───────────────
--
-- SHARE mode: reads go on, inserts, updates and deletes wait until the
-- commit. Creating the index takes the same lock, so nothing is upgraded.

set local lock_timeout = '5s';

do $lock$
begin
  perform set_config('v106.did', '', false);
  if to_regclass('public.discount_requests') is not null then
    lock table public.discount_requests in share mode;
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held discount_requests for more than 5 seconds (%), so v106 did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 1 to 3. Look, then add the index or list ───────────────

do $index$
declare
  v_idx regclass := to_regclass('public.discount_requests_one_pending_per_student');
  v_ok  boolean;
  v_n   int;
begin
  if to_regclass('public.discount_requests') is null then
    raise exception 'public.discount_requests does not exist. Nothing was changed.';
  end if;

  if v_idx is not null then
    select i.indrelid = 'public.discount_requests'::regclass
           and i.indisunique and i.indisvalid and i.indnkeyatts = 1 and i.indnatts = 1
           and a.attname = 'student_id'
           and pg_get_expr(i.indpred, i.indrelid) = '(status = ''pending''::text)'
      into v_ok
      from pg_index i
      left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indexrelid = v_idx;
    if not coalesce(v_ok, false) then
      raise exception 'An index named discount_requests_one_pending_per_student exists and is not the one this file makes (%, valid: %). Nothing was changed.',
        pg_get_indexdef(v_idx), (select indisvalid from pg_index where indexrelid = v_idx);
    end if;
    perform set_config('v106.did', 'there', false);
    return;
  end if;

  select count(*) into v_n
    from (select student_id from public.discount_requests
           where status = 'pending' group by student_id having count(*) > 1) d;
  if v_n > 0 then
    perform set_config('v106.did', 'duplicates', false);
    return;
  end if;

  create unique index discount_requests_one_pending_per_student
    on public.discount_requests (student_id)
    where status = 'pending';
  perform set_config('v106.did', 'added', false);
end
$index$;

commit;

-- ─────────────── What it did ───────────────
--
-- The first row says it. When it added nothing because of duplicates, one
-- row follows per pending request of each student who has more than one,
-- newest first, with what to do with it.

select v106, student_id, request_id, created_at, "do"
  from (
    select 0 as o, null::uuid as s, null::timestamptz as c,
           case current_setting('v106.did', true)
             when 'added'      then 'v106 added the index discount_requests_one_pending_per_student now. A second pending request per student is refused from here on.'
             when 'there'      then 'The index discount_requests_one_pending_per_student was already there. This run changed nothing.'
             when 'duplicates' then 'Not added: '
                                    || (select case when count(*) = 1 then '1 student has' else count(*) || ' students have' end
                                          from (select student_id from public.discount_requests where status = 'pending'
                                                 group by student_id having count(*) > 1) d)
                                    || ' more than one pending request, listed below. Nothing was changed. Keep the newest pending request of each, reject the others in /admin/discounts, then paste this file again.'
           end as v106,
           null::uuid as student_id, null::uuid as request_id, null::timestamptz as created_at, null::text as "do"
    union all
    select 1, r.student_id, r.created_at, null, r.student_id, r.id, r.created_at,
           case when row_number() over (partition by r.student_id order by r.created_at desc, r.id desc) = 1
                then 'keep (the newest, the one the student sees)' else 'reject in /admin/discounts' end
      from public.discount_requests r
     where current_setting('v106.did', true) = 'duplicates'
       and r.status = 'pending'
       and (select count(*) from public.discount_requests e
             where e.student_id = r.student_id and e.status = 'pending') > 1
  ) x
 order by o, s, c desc;
-- EXPECT on production: one row, "v106 added the index ... now." If it says
-- "Not added", decide the requests listed, then paste the file again; it
-- adds the index once no student has two pending.
-- If the file stopped with a message ending "Nothing was changed.", it is
-- true: the whole file is one transaction. A stop on "canceling statement
-- due to lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is
-- the same: nothing was changed. Paste it again in a minute.
