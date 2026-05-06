-- ============================================================
-- v12: Ad-submissions verification gate for discount approval
--
-- Adds a manual-tick flag that admins flip after checking that a
-- student has submitted all their action-item ads in the Discord
-- ad-review channel. /api/discounts/approve refuses to generate a
-- promo code unless this flag is true.
--
-- Three columns:
--   - ad_submissions_verified           bool, default false
--   - ad_submissions_verified_at        nullable timestamptz
--   - ad_submissions_verified_by        nullable uuid (admin user id)
--
-- Default false is intentional: existing students without their
-- ads checked stay gated. Karlo / Astrid tick them manually as
-- they review submissions.
-- ============================================================

alter table students
  add column if not exists ad_submissions_verified boolean not null default false;

alter table students
  add column if not exists ad_submissions_verified_at timestamptz;

alter table students
  add column if not exists ad_submissions_verified_by uuid references auth.users(id);
