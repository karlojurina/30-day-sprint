-- ============================================================
-- HAND FIX: close a 30% request the app cannot close (T-137, v116;
-- 2026-10-26).
--
-- WRITES. Pasted only on the owner's word, with its values filled in, in the
-- SQL editor on the database the app reads, after v116
-- (supabase/migrations/2026_v116_discount_request_history.sql). Not a
-- migration: a file in supabase/hand-fixes/ is never run in sequence with
-- supabase/migrations/.
--
-- WHEN
--   The app leaves a request to the team when it cannot finish it (the 30%
--   page's Why line; supabase/diagnostics/thirty-waiting.sql):
--   * its code is on someone else's membership, on one of another product,
--     or on a free one (landed_elsewhere), and it was fixed in Whop;
--   * its code has no Whop id, so the app cannot ask Whop where it is (code
--     unknown, thirty-waiting.sql part f);
--   * the team made a replacement code in Whop and put it on the student's
--     membership.
--
-- TWO MODES. Fill in the values at the top of the block below, then paste.
--   link    The request takes the replacement code and is marked applied.
--           First its code (promo_code and whop_promo_id), only while the
--           request is approved and its whop_promo_id is the one read
--           (empty when it had none); then applied, only while it is
--           approved with the replacement's Whop id. The trigger records
--           code_changed, then applied, both by sql. The replacement's Whop
--           id (promo_...) and name are read first with Whop's read-only
--           calls: the list of codes (findThirtyCodeByName,
--           src/lib/membership-discount.ts) and the memberships holding the
--           code (findMembershipsWithCode), which must place it on the
--           student's own course membership. Never the first code of that
--           name: names repeat on Whop.
--   reject  The request is rejected with the reason given (the student reads
--           it on the map), only while its status, promo_code and
--           whop_promo_id are the ones read and it is pending or approved.
--           reviewed_at is now and reviewed_by empty (no team member pressed
--           it); the trigger records rejected, by sql. A code the request
--           made stays usable at checkout until someone switches it off in
--           Whop.
--
-- WHAT IT SHOWS: one row, the request as it is after the run, and what this
-- run did ("Nothing was changed: ..." and why, when the request was not as
-- read).
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * v116 is not in this database (the trigger would record nothing).
--   * The mode is neither link nor reject, or the request id is not one.
--   * link: the replacement's Whop id does not start with promo_, or its
--     name is empty.
--   * reject: the status read is not pending or approved, or the reason
--     holds what a student must never read: a code (ECOM30, promo_), an em
--     dash, "unlock" or "EcomTalent".
--
-- Re-runnable: a second run finds the request no longer as read, changes
-- nothing, and says so. One transaction: a stop anywhere changes nothing.
-- ============================================================

-- What the row at the end reads, emptied outside the transaction so a stop
-- does not show an earlier run's words.
select set_config('thirty_close.did', 'The hand fix did not finish in this session. Nothing was changed.', false),
       set_config('thirty_close.request', '', false);

begin;

set local search_path = public;
set local lock_timeout = '5s';

do $close$
declare
  -- ─────────────── Fill in ───────────────
  c_mode        constant text := '';  -- link or reject
  c_request     constant text := '';  -- the request's id
  c_status_read constant text := '';  -- reject: its status as read, pending or approved (link takes approved alone)
  c_code_read   constant text := '';  -- reject: its promo_code as read ('' when it has none)
  c_promo_read  constant text := '';  -- its whop_promo_id as read ('' when it has none)
  c_new_promo   constant text := '';  -- link: the replacement code's Whop id (promo_...)
  c_new_code    constant text := '';  -- link: the replacement code's name
  c_reason      constant text := '';  -- reject: the reason the student reads ('' for none)
  -- ───────────────────────────────────────
  v_id  uuid;
  v_row record;
  v_n   int;
  v_did text;
begin
  if to_regclass('public.discount_request_events') is null
     or not exists (select 1 from pg_trigger t
                     where t.tgrelid = to_regclass('public.discount_requests')
                       and t.tgname = 'discount_request_history' and t.tgenabled <> 'D') then
    raise exception 'v116 is not in this database (no discount_request_events, or no trigger on discount_requests), so this fix would be recorded nowhere. Paste v116 first. Nothing was changed.';
  end if;
  if c_mode not in ('link', 'reject') then
    raise exception 'Fill in the mode at the top of the block: link or reject (it says "%"). Nothing was changed.', c_mode;
  end if;
  if c_request !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Fill in the request''s id at the top of the block (it says "%"). Nothing was changed.', c_request;
  end if;
  if c_mode = 'link' and (c_new_promo !~ '^promo_[A-Za-z0-9]+$' or btrim(c_new_code) = '') then
    raise exception 'link needs the replacement code''s Whop id (promo_...) and its name, read from Whop (they say "%" and "%"). Nothing was changed.', c_new_promo, c_new_code;
  end if;
  if c_mode = 'reject' and c_status_read not in ('pending', 'approved') then
    raise exception 'reject takes a pending or an approved request (the status read says "%"). Nothing was changed.', c_status_read;
  end if;
  if c_mode = 'reject' and (c_reason ~* '(ecom30|promo_|unlock|ecomtalent)' or strpos(c_reason, chr(8212)) > 0) then
    raise exception 'The student reads the reason on the map, and it holds a code, an em dash, "unlock" or "EcomTalent". Write it again without. Nothing was changed.';
  end if;

  v_id := c_request::uuid;
  perform set_config('thirty_close.request', v_id::text, false);

  select r.id, r.status, r.promo_code, r.whop_promo_id into v_row
    from public.discount_requests r where r.id = v_id for update;
  if not found then
    perform set_config('thirty_close.did', 'Nothing was changed: no request has the id ' || v_id || '.', false);
    return;
  end if;

  if c_mode = 'link' then
    -- The code first, while the row is as read.
    update public.discount_requests
       set promo_code = btrim(c_new_code),
           whop_promo_id = c_new_promo
     where id = v_id
       and status = 'approved'
       and whop_promo_id is not distinct from nullif(c_promo_read, '')
       and (promo_code is distinct from btrim(c_new_code) or whop_promo_id is distinct from c_new_promo);
    get diagnostics v_n = row_count;
    v_did := case when v_n = 1 then 'its code is now ' || btrim(c_new_code) || ' (' || c_new_promo || ')' end;
    -- Then applied, while it is approved with the replacement.
    update public.discount_requests
       set status = 'applied',
           applied_at = now()
     where id = v_id
       and status = 'approved'
       and whop_promo_id = c_new_promo;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      perform set_config('thirty_close.did', 'Linked: ' || coalesce(v_did || ', then it was', 'it held ' || btrim(c_new_code) || ' already, and it was')
                                             || ' marked applied.', false);
    elsif v_did is not null then
      perform set_config('thirty_close.did', 'Linked: ' || v_did || ', but it was not marked applied.', false);
    else
      perform set_config('thirty_close.did', 'Nothing was changed: the request is ' || v_row.status || ' with whop_promo_id '
                                             || coalesce(v_row.whop_promo_id, 'empty') || ', not approved with '
                                             || coalesce(nullif(c_promo_read, ''), 'empty') || ' as read. If this file ran before, it is done.', false);
    end if;
  else
    update public.discount_requests
       set status = 'rejected',
           rejection_reason = nullif(btrim(c_reason), ''),
           reviewed_at = now(),
           reviewed_by = null
     where id = v_id
       and status = c_status_read
       and promo_code is not distinct from nullif(c_code_read, '')
       and whop_promo_id is not distinct from nullif(c_promo_read, '');
    get diagnostics v_n = row_count;
    if v_n = 1 then
      perform set_config('thirty_close.did', 'Rejected (it was ' || v_row.status || ').'
                                             || coalesce(' The code ' || v_row.promo_code
                                                         || ' stays usable at checkout until someone switches it off in Whop.', ''), false);
    else
      perform set_config('thirty_close.did', 'Nothing was changed: the request is ' || v_row.status || ' with promo_code '
                                             || coalesce(v_row.promo_code, 'empty') || ' and whop_promo_id '
                                             || coalesce(v_row.whop_promo_id, 'empty') || ', not as read. If this file ran before, it is done.', false);
    end if;
  end if;
end
$close$;

commit;

select current_setting('thirty_close.did', true) as thirty_close,
       r.id as request_id, r.status, r.promo_code, r.whop_promo_id, r.reviewed_at, r.applied_at, r.rejection_reason
  from (select 1) as one
  left join public.discount_requests r
    on r.id::text = nullif(current_setting('thirty_close.request', true), '');
-- EXPECT one row: what the run did, then the request as it is now. link:
-- "Linked: its code is now ... then it was marked applied.", status
-- applied. reject: "Rejected (it was ...).", status rejected. A second run:
-- "Nothing was changed: ... If this file ran before, it is done." and the
-- row as the first run left it.
