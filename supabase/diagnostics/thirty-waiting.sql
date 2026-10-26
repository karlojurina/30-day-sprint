-- ============================================================
-- The automatic 30%: what is waiting, and whether the history is whole
-- (T-137, v116; 2026-10-26).
--
-- READ ONLY: one select. It changes no row and locks nothing. Paste it into
-- the SQL editor on the database the app reads, after v116
-- (supabase/migrations/2026_v116_discount_request_history.sql).
--
-- WHEN
--   * Right after v116 is pasted, before the build goes live: parts b, c, e
--     and f want no row. A row in part f is an approved request the app
--     cannot check: close each one with
--     supabase/hand-fixes/thirty-close-request.sql (link) before go-live.
--   * Whenever a request seems stuck, or the Dashboard's "30% needs a hand"
--     is not 0.
--
-- READ IT BY PART (the first column)
--   a. waiting  Every request from 1 October (2026-09-30 22:00 UTC) still
--      pending or approved, oldest first: its age in hours, and the newest
--      failed attempt (attempt_failed) with its reason, step and time, or
--      "no failed attempt yet"; n is how many attempts failed.
--   b. claimed name, no Whop id  Requests of any status holding a code name
--      (promo_code) with no whop_promo_id: a claim. Pending and claimed
--      under 5 minutes ago, the app is making the code now; older, the app
--      (or Reject) looks the name up on Whop before anything new is made.
--      Approved, applied or rejected, someone wrote the row by hand.
--      age_hours is the claim's age (the request's when it has no claim
--      time).
--   c. status with no event  Requests made since the first event whose
--      status has no event that put it there (pending: requested or
--      reopened; approved: code_made; applied: applied; rejected:
--      rejected). A write the trigger could not record (it raised a
--      warning), or one made with the trigger off. Want none.
--   d. events per day  How many of each event were recorded each day in
--      Croatia, newest day first (n).
--   e. write_failed, last 30 days  Every write_failed attempt of the last 30
--      days, any request, with its step and code: decided_meanwhile (Whop
--      made a code for a request decided meanwhile: delete the code in
--      Whop), approved_write_error (Whop made a code the app could not
--      save: the app picks it up on its next try), attach_after_reject
--      (Whop attached the code after the request was rejected: it can only
--      come off in Whop; "confirmed false" when Whop may have). Want none.
--   f. approved, code unknown  Approved requests with no whop_promo_id: the
--      app cannot ask Whop where their code is, so it leaves them to the
--      team. Want none at go-live.
--
-- A part with nothing to show has no row. Rows come by part, then oldest
-- first (d: newest day first). Times are in Croatia (Europe/Zagreb).
-- ============================================================

with
  failed as (
    select e.request_id,
           e.reason,
           e.detail ->> 'step' as step,
           e.created_at,
           row_number() over (partition by e.request_id order by e.created_at desc, e.id desc) as nth,
           count(*) over (partition by e.request_id) as n
      from public.discount_request_events e
     where e.event = 'attempt_failed'),
  first_event as (
    select min(created_at) as at from public.discount_request_events)
select part, request_id, student_id, status, at_croatia, age_hours, what, n
  from (
    -- a. waiting
    select 'a. waiting' as part, 1 as o, extract(epoch from r.created_at) as k,
           r.id as request_id, r.student_id, r.status,
           to_char(r.created_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI') as at_croatia,
           round((extract(epoch from (now() - r.created_at)) / 3600)::numeric, 1) as age_hours,
           coalesce('newest failure ' || f.reason || coalesce(' (step ' || f.step || ')', '')
                      || ' at ' || to_char(f.created_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI'),
                    'no failed attempt yet') as what,
           coalesce(f.n, 0)::int as n
      from public.discount_requests r
      left join failed f on f.request_id = r.id and f.nth = 1
     where r.status in ('pending', 'approved')
       and r.created_at >= timestamptz '2026-09-30 22:00:00+00'
    union all
    -- b. claimed name, no Whop id
    select 'b. claimed name, no Whop id', 2, extract(epoch from coalesce(r.promo_claimed_at, r.created_at)),
           r.id, r.student_id, r.status,
           to_char(r.created_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI'),
           round((extract(epoch from (now() - coalesce(r.promo_claimed_at, r.created_at))) / 3600)::numeric, 1),
           'code ' || r.promo_code || ', '
             || coalesce('claimed ' || to_char(r.promo_claimed_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI'), 'no claim time'),
           null::int
      from public.discount_requests r
     where r.promo_code is not null
       and r.whop_promo_id is null
    union all
    -- c. status with no event
    select 'c. status with no event', 3, extract(epoch from r.created_at),
           r.id, r.student_id, r.status,
           to_char(r.created_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI'),
           null::numeric,
           'no ' || case r.status when 'pending' then 'requested or reopened' when 'approved' then 'code_made'
                                  else r.status end
             || ' event; its events: '
             || coalesce((select string_agg(e.event, ', ' order by e.created_at, e.id)
                            from public.discount_request_events e where e.request_id = r.id), 'none'),
           null::int
      from public.discount_requests r
     where r.created_at >= (select at from first_event)
       and not exists (
             select 1
               from public.discount_request_events e
              where e.request_id = r.id
                and e.event = any (case r.status
                                     when 'pending'  then array['requested', 'reopened']
                                     when 'approved' then array['code_made']
                                     when 'applied'  then array['applied']
                                     when 'rejected' then array['rejected']
                                   end))
    union all
    -- d. events per day
    select 'd. events per day', 4, -extract(epoch from (e.created_at at time zone 'Europe/Zagreb')::date::timestamp),
           null::uuid, null::uuid, null::text,
           to_char((e.created_at at time zone 'Europe/Zagreb')::date, 'YYYY-MM-DD'),
           null::numeric,
           e.event,
           count(*)::int
      from public.discount_request_events e
     group by (e.created_at at time zone 'Europe/Zagreb')::date, e.event
    union all
    -- e. write_failed, last 30 days
    select 'e. write_failed, last 30 days', 5, extract(epoch from e.created_at),
           e.request_id, e.student_id, r.status,
           to_char(e.created_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI'),
           null::numeric,
           'step ' || coalesce(e.detail ->> 'step', 'none')
             || coalesce(', code ' || (e.detail ->> 'code'), '')
             || case when e.detail ->> 'confirmed' = 'false' then ', confirmed false' else '' end,
           null::int
      from public.discount_request_events e
      left join public.discount_requests r on r.id = e.request_id
     where e.event = 'attempt_failed'
       and e.reason = 'write_failed'
       and e.created_at >= now() - interval '30 days'
    union all
    -- f. approved, code unknown
    select 'f. approved, code unknown', 6, extract(epoch from r.created_at),
           r.id, r.student_id, r.status,
           to_char(r.created_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI'),
           null::numeric,
           'code ' || coalesce(r.promo_code, 'none') || ', no Whop id'
             || coalesce(', approved ' || to_char(r.reviewed_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI'), ''),
           null::int
      from public.discount_requests r
     where r.status = 'approved'
       and r.whop_promo_id is null
  ) x
 order by o, k, request_id, what;
