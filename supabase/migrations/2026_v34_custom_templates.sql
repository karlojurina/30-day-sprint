-- ============================================================
-- v34: Custom templates with editable triggers.
--
-- Two new columns on the existing templates table:
--   is_custom       — true for templates created via /admin/templates
--                     (false for the 20 seeded built-ins)
--   trigger_config  — JSON DSL the cron evaluates against each
--                     student snapshot. Null for built-ins (they have
--                     hardcoded trigger functions in src/lib/csm-triggers.ts).
--
-- Trigger config shape (flat AND of conditions):
--   {
--     "all": [
--       { "metric": "day_number",            "op": "at_least", "value": 7 },
--       { "metric": "region_lessons_watched","region": "r1", "op": "at_least", "value": 10 },
--       { "metric": "lesson_shipped",        "lesson_id": "l018", "op": "is_not" }
--     ]
--   }
--
-- See src/lib/csm-triggers.ts → evaluateCustomTrigger for the
-- evaluator + the full list of supported metrics + ops.
--
-- Idempotent.
-- ============================================================

alter table templates
  add column if not exists is_custom      boolean not null default false,
  add column if not exists trigger_config jsonb;

-- Loose check that the JSON has the expected top-level shape.
-- Detailed validation happens in the application layer where we can
-- give the user a friendly error.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'templates_trigger_config_shape_chk'
  ) then
    alter table templates
      add constraint templates_trigger_config_shape_chk
      check (
        trigger_config is null
        or (
          jsonb_typeof(trigger_config) = 'object'
          and jsonb_typeof(trigger_config -> 'all') = 'array'
        )
      );
  end if;
end $$;

-- Speeds up the cron's "find active custom templates" query.
create index if not exists idx_templates_custom_active
  on templates(is_custom, is_active)
  where is_custom = true and trigger_config is not null;
