-- ============================================================
-- v27: CSM layer (Astrid's task queue + 20 DM templates + admin config)
--
-- Adds:
--   1. admin_config  — key/value store for editable URLs (booking link,
--                      program login link, Karlo walkthrough video).
--   2. templates     — body text + metadata for all 20 Astrid DM templates,
--                      seeded from lovro-brief/context/templates.md.
--                      Editable from /admin/templates (the canonical source).
--   3. tasks         — Astrid's queue. One row per scenario fire.
--                      Unique-when-open partial index dedupes.
--
-- This migration is idempotent. Templates are upserted on scenario_id so
-- re-running it doesn't clobber Karlo / Astrid edits made through the UI.
-- (To force a hard reseed from this file, delete the relevant template
-- rows in Supabase first, then re-run.)
-- ============================================================


-- ─────────────── 1. admin_config ───────────────

create table if not exists admin_config (
  key         varchar(64) primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references team_members(id)
);

alter table admin_config enable row level security;

drop policy if exists "Team reads admin_config" on admin_config;
create policy "Team reads admin_config"
  on admin_config for select
  using (public.current_user_is_team());

-- Writes are gated to founder + admin roles only.
drop policy if exists "Founders/admins write admin_config" on admin_config;
create policy "Founders/admins write admin_config"
  on admin_config for all
  using (exists (
    select 1 from team_members
    where id = auth.uid() and role in ('founder','admin')
  ))
  with check (exists (
    select 1 from team_members
    where id = auth.uid() and role in ('founder','admin')
  ));


-- ─────────────── 2. templates ───────────────

create table if not exists templates (
  id                  uuid primary key default gen_random_uuid(),
  scenario_id         varchar(16) not null unique,
  bucket              varchar(16) not null,            -- crushing / on_track / at_risk / cancel_path / event / admin
  week                varchar(8),                       -- D1 / W1 / W2 / W3 / W4 / X / null
  title               varchar(160) not null,
  trigger_description text not null,
  intent              text,
  tone                text,
  variables           jsonb not null default '[]'::jsonb,
  body                text not null default '',
  word_count          int,
  is_active           boolean not null default true,
  is_admin_only       boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_templates_scenario   on templates(scenario_id);
create index if not exists idx_templates_active     on templates(is_active);
create index if not exists idx_templates_bucket     on templates(bucket);

alter table templates enable row level security;

drop policy if exists "Team reads templates" on templates;
create policy "Team reads templates"
  on templates for select
  using (public.current_user_is_team());

drop policy if exists "Founders/admins write templates" on templates;
create policy "Founders/admins write templates"
  on templates for all
  using (exists (
    select 1 from team_members
    where id = auth.uid() and role in ('founder','admin')
  ))
  with check (exists (
    select 1 from team_members
    where id = auth.uid() and role in ('founder','admin')
  ));

-- updated_at touch trigger
drop trigger if exists trg_templates_updated_at on templates;
create trigger trg_templates_updated_at
  before update on templates
  for each row execute function public.set_updated_at();


-- ─────────────── 3. tasks ───────────────

create table if not exists tasks (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  scenario_id       varchar(16) not null,
  template_id       uuid references templates(id) on delete set null,
  status            varchar(16) not null default 'open',  -- open / completed / dismissed
  behavior_summary  text,                                  -- concrete state at fire time
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  completed_by      uuid references team_members(id),
  dismissed_at      timestamptz,
  dismissed_by      uuid references team_members(id),
  notes             text
);

create index if not exists idx_tasks_status_created
  on tasks(status, created_at desc);
create index if not exists idx_tasks_student on tasks(student_id);
create unique index if not exists idx_tasks_unique_open
  on tasks(student_id, scenario_id) where status = 'open';

alter table tasks enable row level security;

drop policy if exists "Team reads tasks" on tasks;
create policy "Team reads tasks"
  on tasks for select
  using (public.current_user_is_team());

drop policy if exists "Team writes tasks" on tasks;
create policy "Team writes tasks"
  on tasks for all
  using (public.current_user_is_team())
  with check (public.current_user_is_team());


-- ─────────────── 4. Seed admin_config ───────────────
--   Placeholder values; founder/admin edits via /admin/settings.

insert into admin_config (key, value, description) values
  ('astrid_booking_link',          'https://cal.com/astrid-ecomtalent/onboarding',
   'Astrid''s onboarding call booking link, used in template D1.A.'),
  ('program_login_link',           'https://sprint.ecomtalent.com/login',
   'URL students click to enter the 30-Day Sprint dashboard, used in D1.B.'),
  ('karlo_walkthrough_video_link', '',
   'Karlo''s 30-Day Sprint dashboard walkthrough video, used in D1.B. Empty until Karlo records it.')
on conflict (key) do nothing;


-- ─────────────── 5. Seed templates ───────────────
--   Source: lovro-brief/context/templates.md (snapshot 16-05-2026).
--   Bodies use dollar-quoted strings so embedded ' / { / } / emojis pass through.
--   ON CONFLICT (scenario_id) DO NOTHING — re-running doesn't clobber UI edits.

insert into templates
  (scenario_id, bucket, week, title, trigger_description, intent, tone, variables, body, word_count, is_admin_only)
values

-- ─── D1.A ───
('D1.A', 'event', 'D1',
 'Wants a call (onboarding form path A)',
 'Onboarding form submitted, "wants call" = Yes (team Discord channel ping + Notion row).',
 'Welcome warmly + book the call ASAP + tease that the call will help them get to a first win fast. Save the substance for the call.',
 'Bubbly, warm, approachable. Astrid genuinely excited to meet them. Real person, not corporate CSM voice.',
 '["firstName","bookingLink"]'::jsonb,
 $$Hey {firstName}! 🙌

Welcome to EcomTalent — so happy you're here! I'm Astrid, and I'll be your point of contact while you're with us.

Love that you're up for a call to kick things off! On the call I'll help you get fully set up and walk you through exactly how to get to your first win inside the program as fast as possible.

Grab a time that works for you here: {bookingLink}

In the meantime, two easy things to do:

— Hop into Discord and introduce yourself in the community chat. There are tons of awesome students on the same path as you right now, and they love saying hi to new folks.

— Start watching the modules whenever you're ready. We can break down anything you're unsure about when we hop on the call.

If a question comes up while you're getting started, the Discord community is your best first stop — students going through the exact same thing can usually jump in and help fast. Anything bigger that needs me, I'm here too.

Can't wait to chat soon! 🎉$$,
 160, false),

-- ─── D1.B ───
('D1.B', 'event', 'D1',
 'No call (onboarding form path B)',
 'Onboarding form submitted, "wants call" = No.',
 'Warm welcome → push them to Karlo''s walkthrough video FIRST → then the dashboard link → flag the discount as something visible on the map → community-first for help.',
 'Warm, approachable, "totally cool you skipped the call, here''s everything you need."',
 '["firstName","videoLink","programLink"]'::jsonb,
 $$Hey {firstName}! 🙌

Welcome to EcomTalent — so happy you're here! I'm Astrid, and I'll be your point of contact while you're with us.

Totally cool that you'd rather get right into it without a call. Here's a quick rundown of what you're getting and how to get going.

**Before you do anything else — please watch this video:** {videoLink}

It's Karlo personally walking you through the 30-Day Sprint dashboard — what it is, how it works, and how to use it. It'll save you a ton of time and confusion once you're in there.

Once you've watched it, jump into the dashboard here: {programLink}

A couple things worth knowing as you get started:

— **You're not on your own.** I'll be checking in along the way, and the coaches in the community give feedback on your work whenever you're ready to share it.

— **There's a 30% discount on month two** waiting for you inside the dashboard. The video covers exactly how it works.

If a question comes up while you're getting started, the Discord community is your best first stop — students going through the exact same thing can usually jump in and help fast. Anything bigger that needs me, I'm here too.

So happy to have you! Let's get going 🚀$$,
 225, false),

-- ─── W1.1 ───
('W1.1', 'crushing', 'W1',
 '★ Region 1 complete (Week 1 celebration)',
 'All R1 lessons complete, including both compound action items (l018 + l020) with action_completed_at set. Fires whenever R1 hits 100%.',
 'Celebrate the milestone of finishing R1. Tee up R2''s heavier ad formats.',
 'Warm, sincere, weighted. Real respect, not hype.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}! 🔥

You finished all of region 1 - both action items shipped, every lesson done. A lot of students don't make it through this part. Real respect.

The fact that you actually shipped the ads instead of overthinking them is the part that matters most. Trust me on that.

Region 2 just unlocked - the ad formats get a bit heavier from here (vsl + high-prod). You've handled the first two, you'll handle these.

Keep cooking 👨‍🍳$$,
 85, false),

-- ─── W1.2 ───
('W1.2', 'at_risk', 'W1',
 '⚠ Watched lessons but no action',
 '≥10 R1 lessons watched, but neither l018 nor l020 has action_completed_at set by end of Day 7.',
 'Name the activation gap without shaming. Push them to ship a rough one.',
 'Warm opener acknowledging they care, honest pivot, supportive close.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 🫡

Saw you've been going through the lessons - 10+ watched. That means you care.

Want to be real with you for a sec though.

There's a moment where this stops being about watching and starts being about doing. You're there. Two action items waiting at the end of region 1, and I get it - they probably feel scary right now.

Watching feels productive. Shipping feels exposed.

The shipping part is where things actually click. You don't need another lesson to make you "ready" - what you've already learned is enough to make a rough one. Coaches will give you real feedback either way.

Pick one. Give it 30 minutes. Hit submit. It doesn't have to be good, it just has to leave your hands.

You've got this 💪$$,
 145, false),

-- ─── W1.3 ───
('W1.3', 'at_risk', 'W1',
 '⚠ Slow start (low completion in first few days)',
 '<3 lessons completed by end of Day 4.',
 'Warm check-in. Name the truth without lecturing. Tiny achievable next step.',
 'Warm, understanding. "Quick check-in" register.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 👋

Quick check-in - saw you joined a few days ago but haven't really had a chance to watch lessons yet. Totally normal, life gets messy.

One honest thought though.

The first 30 minutes is the hardest part. Once you sit down and actually start, the program kind of pulls you in.

Most students who tell me "I just can't get into it" - it's almost always because they're trying to find the perfect time to start instead of just starting.

If you can carve out 30 minutes today, that's enough. Don't try to do it all - just one lesson, one click. The rest gets easier from there.

Anything blocking you I can help with? Quick reply telling me what's going on would help me figure out the right next step 💛$$,
 140, false),

-- ─── W1.4 ───
('W1.4', 'cancel_path', 'W1',
 '✗ No login since signup (5+ days)',
 'Logged in once at signup, no return for 5+ days (existing no_login_5d alert).',
 'Warm last-chance touch. Open the door — message Astrid or the community.',
 'Sincere, non-judgmental. Astrid as the reaching-back hand.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 👋

Wanted to reach out personally - noticed you signed up but haven't watched any lessons on Whop yet. No judgment, just checking on you.

If life got loud, I get it. We've all been there.

But I'd hate for you to lose what you joined for just because you couldn't find the first 30 minutes to start. The whole program builds on momentum, and the longer you wait, the heavier that first step feels. Trust me, I've seen it a bunch of times.

If you need any help getting started, message me here or drop a question in the community - tons of students who started exactly where you are now and would love to help.

We're rooting for you 💛$$,
 125, false),

-- ─── W2.1 ───
('W2.1', 'crushing', 'W2',
 '★ Region 2 complete (discount unlock moment)',
 'All R2 lessons complete incl. l022 + l024 with action_completed_at set. Fires whenever R2 hits 100%.',
 'Celebrate the milestone + signal that the discount widget is now live in their dashboard. Set up R3.',
 'Warm, weighted, specific. No "way ahead" framing — works for fast pacers AND on-time completers.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}! 🔥

Region 2 done. That's the heaviest content region in the whole program - the editing breakdowns alone are hours of footage. Getting all the way through is no joke.

You should see the 30% discount unlock in your dashboard now - go grab it whenever you're ready.

Region 3 is up next: static ads, money-making methods, creative strategy. Different gear from R1 and R2 but you've shown you can handle whatever's next.

Keep cooking 👨‍🍳$$,
 95, false),

-- ─── W2.2 ───
('W2.2', 'crushing', 'W2',
 '★ Shipped both VSL + High-Prod compounds (portfolio milestone)',
 'l022 + l024 both action_completed_at set early in R2.',
 'Celebrate the 4-format milestone + reframe as portfolio building for the job board.',
 'Warm celebration, forward-looking toward the job board.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 🙌

Both your vsl and high-prod ads are in. That's 4 ad formats shipped total now (organic, ugc, vsl, high-prod). Trust me, a lot of students never get this far.

Take a sec to look at that.

Coaches will drop feedback as they review.

One thing worth flagging - now you've got 4 different ad formats shipped, that's a real portfolio building up. When you start applying to jobs on the job board, this is exactly the stuff brands look for.

Keep going - you're building serious momentum 🔥$$,
 115, false),

-- ─── W2.3 ───
('W2.3', 'at_risk', 'W2',
 '⚠ No VSL/High-Prod shipped, watching lessons',
 'l022 + l024 not shipped by Day 10, ≥5 R2 lessons watched.',
 'Activation-gap nudge for the heavier R2 compounds. Acknowledge engagement, push to ship.',
 'Warm opener, honest pivot, supportive close.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 🫡

Saw you've been going through region 2 lessons - nice, you're staying with it.

Want to flag something though.

The two action items at the start of region 2 (vsl + high-production) are still sitting there. You don't have to wait until you've watched everything to ship them - the longer you wait, the heavier they feel. Trust me on that.

These two are a bit more involved than the first two ads. That's normal, they're meant to stretch you. But the goal isn't to make them perfect, just to ship and get real feedback from the coaches.

Pick one. Give yourself a chunk of time today or tomorrow. Submit it. You've already proven you can do this with R1 - second pair just needs you to start.

You've got this 💪$$,
 145, false),

-- ─── W2.4 ───
('W2.4', 'at_risk', 'W2',
 '⚠ Behind pace, still in R1 around Day 9',
 'R1 < 100% by Day 9.',
 'Flag behind-pace without lecturing. Lay out path to discount + give permission to skip it if life''s heavy.',
 'Honest, respectful, non-judgmental.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 👋

Quick check-in - saw you're still working through region 1. Totally okay, just wanted to flag something so you can make an informed choice.

If you want to grab the 30% off month two, the countdown in your dashboard is moving. To make it in time, you'd need to finish region 1 and get all the way through region 2 before it hits zero.

It's still possible if you push for a few days. Or if life's a lot right now, totally fine to keep moving at your own pace - the program isn't going anywhere, and tbh the 30% isn't the real point of being here.

Either way, wanted you to know where you stand. Anything I can help with?$$,
 130, false),

-- ─── W2.5 ───
('W2.5', 'at_risk', 'W2',
 '⚠ Day 12+ still in R1 (winning mindset reframe)',
 'Day ≥ 12 and R1 incomplete.',
 'Mindset over mechanics. "We want you to win, the only way you win is by actually watching lessons and taking action." Not "you missed the discount."',
 'Direct, warm, conviction-led. Karlo-tier authenticity.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 👋

Wanted to reach out personally - saw you're still in region 1. Want to be real with you for a sec.

We want you to win. Genuinely. That's why this community exists in the first place, and it's why I'm in your DMs right now instead of letting you fade out.

But you can't win if you don't actually watch the lessons and take action on them. That's the only way anything changes - trust me on that.

So forget timelines, forget pace, forget whether you're "behind." None of that matters. Just pick up the next lesson today and keep moving from there.

Anything I can help with? Even a quick reply telling me what's going on would help me figure out where to point you.

We're rooting for you 💛$$,
 140, false),

-- ─── W2.6 — admin-only, no DM body ───
('W2.6', 'admin', 'W2',
 '⚡ Discount applied (admin task, no DM)',
 'New row in discount_requests with status = pending. Fires the moment a student clicks Apply on the discount widget after completing R2.',
 'Admin task only — Astrid reviews in /admin/discounts, verifies R1+R2 completion + ad submissions, ticks ad_submissions_verified, approves or rejects.',
 'N/A (admin-only).',
 '[]'::jsonb,
 '',
 0, true),

-- ─── W2.7 ───
('W2.7', 'cancel_path', 'W2',
 '✗ Inactive since end of Week 1',
 'No completion in 5+ days, no login in 5+ days during Week 2.',
 'Re-engagement with empathy. Open the door.',
 'Sincere, warm, non-judgmental.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 👋

Wanted to check in - noticed you haven't been around in about a week. No judgment, just making sure you're okay.

If something's going on outside the program, I get it. Life shows up sometimes, the program has to wait.

But if you're not sure whether to keep going, I'd really like to know. Sometimes there's a small thing in the way making the whole program feel impossible, and naming it can make all the difference.

If you want to talk through it, message me here. Or just drop a question in the community when you're ready to come back - tons of students there who've been exactly where you are. The lessons are right where you left them, the next one is enough.

We're rooting for you 💛$$,
 135, false),

-- ─── W3.1 ───
('W3.1', 'crushing', 'W3',
 '★ Region 3 complete (opportunities opening up)',
 'All R3 lessons complete. Fires whenever R3 hits 100%.',
 'Reposition R3 completion around what they can now do — apply to jobs, start bounties. Make them feel the door is open.',
 'Direct, real, conviction. About what they can do now.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}! 🔥

Region 3 done. Want to point something out.

By this point, you know how to make ads across multiple formats. You understand the strategy behind why they work. You know how to land clients. And you've seen exactly how the bounty system pays out.

You're equipped now. That's not me hyping you up - that's just facts.

What that means: opportunities are starting to open up for you. The job board in discord has new postings most days, and you're qualified for a lot of them. You'll start shipping bounties for real brands in region 4 too.

Keep crushing it ⛏️$$,
 120, false),

-- ─── W3.2 ───
('W3.2', 'at_risk', 'W3',
 '⚠ Day 21+ still in R2',
 'Day ≥ 21 and R2 incomplete.',
 'Significant intervention. Frame R4 as the payoff moment without naming bounties (they haven''t reached the bounty deep-dive yet).',
 'Direct, honest, supportive.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 👋

Wanted to reach out - saw you're still in region 2. Want to be real with you.

You've got time left in the sprint, but the road ahead is steep. All of region 3 + region 4 still waiting. To finish the full sprint, you'd need to do about 2 lessons a day from here. Doable but tight.

If you can push, finishing all 30 days is genuinely worth it. Region 4 is where everything you've put in so far finally pays off - that's the part of the program that makes the work click.

If life is too much right now, no shame. Just keep moving at whatever pace you can. The lessons aren't going anywhere.

Either way, let me know how I can help 💛$$,
 140, false),

-- ─── W3.3 ───
('W3.3', 'cancel_path', 'W3',
 '✗ Inactive Week 3 (5+ days no completion)',
 'No completion in 5+ days during Days 15–23 (existing no_lessons_7d alert).',
 'Re-engagement with empathy. Frame R4 as the payoff without naming bounties.',
 'Sincere, warm, non-judgmental.',
 '["firstName"]'::jsonb,
 $$Hey {firstName} 👋

Wanted to check in - noticed you haven't been around for about a week. Just making sure you're okay.

The most impactful part of the program is still ahead. Region 4 is where everything you've put in so far actually pays off - that's where the program clicks for most people.

If something pulled you away, I get it. But if you're on the edge of giving up, I'd really like to know first. Sometimes there's a small thing blocking the next step that we can sort out together.

Message me here when you can. Or drop a question in the community if you want to ease back in - tons of students there who've been exactly where you are.

We're rooting for you 💛$$,
 130, false),

-- ─── W4.1 ───
('W4.1', 'at_risk', 'W4',
 '⚠ Day 25+ still in R3',
 'Day ≥ 25 and R3 incomplete.',
 'Honest urgency — they might miss R4 entirely. Frame R4 as the activation moment that makes the sprint worth doing.',
 'Warm + honest, no shame.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}!

Wanted to flag something — you're in the last stretch of the sprint, and Region 3 isn't quite wrapped up yet. Not a huge deal, but want to be honest with you about what's coming.

Region 4 is where you actually ship real ad bounties for real brands — it's where everything you've done so far actually gets applied. If you don't get there, you'll have done a lot of learning without the moment where it all becomes real.

The math: a few solid pushes over the next few days and you're in R4. Even getting one or two bounty submissions in before Day 30 is enough to make the whole sprint pay off.

Anything I can help with to clear the path?

We're rooting for you 💛$$,
 145, false),

-- ─── W4.2 ───
('W4.2', 'at_risk', 'W4',
 '⚠ Day 30 with sprint incomplete (still active)',
 'Day = 30, sprint progress < 100%, membership_status = active (Kanban → Month 2+).',
 'Acknowledge they made the bigger decision (still paying). Reframe incomplete-sprint as fine. Lay out Month 2 options without pressure.',
 'Warm, validating, forward-looking. The student matters more than the completion %.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}!

Day 30! You made it to the end of the sprint and you're still here — that itself says something about you.

Saw you didn't fully wrap up Region 4, but that's totally fine. Honestly, finishing the sprint perfectly isn't the goal — the goal is what you do from here.

If you can, finishing the last bit of R4 is worth it — shipping at least one real ad bounty is the experience that makes this whole thing click. Otherwise, keep watching lessons you haven't gotten to, or start applying what you've learned to real work. The program isn't going anywhere.

Let me know what you're thinking, or just keep going at your own pace.

Proud of you for sticking with it 💛$$,
 150, false),

-- ─── W4.3 ───
('W4.3', 'cancel_path', 'W4',
 '✗ No login Week 4 (5+ days)',
 'No login in 5+ days during Days 24–30 (existing no_login_5d alert).',
 'Last-chance touch before Day 30. Name what they''re about to miss without manipulating.',
 'Warm, honest, respectful of their autonomy.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}!

Wanted to reach out — haven't seen you in about a week, and we're in the final stretch of the sprint.

Region 4 is happening right now in the program — the part where students actually ship real ad bounties for real brands. It's the moment most of these 30 days were building toward. If you've got the bandwidth to come back in, even briefly, this is the part worth showing up for.

If you've made a different call, totally understand. Life happens. But I'd hate for you to walk away right before the most useful part without at least knowing that's actually your call.

Message me here if you want to talk through it, or just jump back in. The lessons are right where you left them.

We're rooting for you 💛$$,
 145, false),

-- ─── W4.4 ───
('W4.4', 'cancel_path', 'W4',
 '✗ Day 30 — churned (canceled)',
 'membership_status = canceled (Kanban → Churned). Fires from Whop membership.deactivated webhook.',
 'Final touch-back. No retention pitch. Warm closure + feedback ask + open door.',
 'Sincere, no pressure, dignified.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}!

Saw your membership wrapped up — wanted to send one final message.

No hard sell, no pitch. Just want to say thanks for giving this a real shot. EcomTalent isn't for everyone, and that's actually okay.

If something specific made the program not work for you, I'd genuinely love to hear it — even a one-line reply helps us build something better for the next person coming in.

And if you ever want to come back, the door's open. No pressure.

Take care 💛$$,
 110, false),

-- ─── X.1 ───
('X.1', 'event', 'X',
 '🔁 Reactivation (was inactive, came back)',
 'Student had an active disengagement_alert, then completed a lesson.',
 'Welcome them back without making it a thing. No catch-up pressure.',
 'Light, warm, no big speech.',
 '["firstName"]'::jsonb,
 $$Hey {firstName}!

Saw you came back and finished a lesson — really glad to see you 🙌

No big speech, just wanted to say it's good to have you back. The program is right here whenever you're ready, and you don't need to catch up on everything — just take it at whatever pace works.

If anything's been blocking you or you want to talk it through, I'm here. Otherwise, just keep going.

Proud of you for picking it back up 💛$$,
 85, false)

on conflict (scenario_id) do nothing;


-- ─────────────── 6. Sanity checks (commented) ───────────────
-- select count(*) from admin_config;             -- expect 3
-- select count(*) from templates;                -- expect 21 (20 with body + 1 admin-only)
-- select count(*) from templates where is_admin_only;  -- expect 1 (W2.6)
-- select scenario_id from templates order by scenario_id;
