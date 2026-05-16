-- ============================================================
-- v28: Discord message link capture on action-item lessons.
--
-- Adds student_lesson_completions.discord_message_link so students
-- can paste the #ad-review submission URL on the lesson sheet after
-- marking the action complete. Admin surfaces (student detail page +
-- /admin/discounts review + the task queue cards for W1.2 / W2.2) read
-- this column to verify submissions without scrolling Discord.
--
-- Spec: lovro-brief/04-link-capture.md
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table student_lesson_completions
  add column if not exists discord_message_link varchar(255);

-- Discord message URLs look like:
--   https://discord.com/channels/<guild>/<channel>/<message>
-- All three trailing path components are numeric. Validation matches
-- this loosely; nulls + empties are allowed (students can clear or
-- skip the link).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'discord_message_link_format_chk'
  ) then
    alter table student_lesson_completions
      add constraint discord_message_link_format_chk
      check (
        discord_message_link is null
        or discord_message_link ~ '^https://discord\.com/channels/[0-9]+/[0-9]+/[0-9]+/?$'
      );
  end if;
end $$;
