-- ============================================================================
-- v88 — store the Whop MEMBER id for each link's owner
--
-- Whop has three id types and they are not interchangeable:
--   user_…  the Whop user          (what we already store)
--   mem_…   one membership         (what a seat is)
--   mber_…  the company MEMBER     (what the owner's dashboard page is keyed on)
--
-- The owner's page is https://whop.com/dashboard/<biz>/users/<mber_id>/ — the
-- screen Lovro opens to confirm a brand really has stopped paying. Nothing we
-- already held could produce that id.
--
-- WHY STORED RATHER THAN FETCHED: only the v1 API exposes member ids, and every
-- v1 membership filter (product_id, product, access_pass_id) is SILENTLY
-- IGNORED — verified: filtering to ETfB returned 48 of 50 rows on other
-- products. So resolving this live means walking all 8,192 memberships, 82+
-- pages, on every page load. It is stable identity, in the same class as the
-- owner_name / owner_email snapshots already on this table.
--
-- Backfill below was produced by that walk (119 pages, 6,305 user->member
-- mappings) and spot-checked against the URL Lovro pasted:
-- user_xqfmq4BYgZ8Sq -> mber_45nRG2SP3iGzN.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

alter table etfb_team_links add column if not exists owner_member_id text;

comment on column etfb_team_links.owner_member_id is
  'Whop MEMBER id (mber_…) for owner_whop_user_id. Keys the owner''s dashboard page. Not the same as a user id or a membership id.';

-- Backfill: 108 of 108 links with a known owner
update etfb_team_links as t set owner_member_id = v.mber
from (values
  ('plan_W7jZXgtUAnBJB', 'mber_v00W7qR4Tk7Rf'),
  ('plan_qFZ0ouSjpzZg7', 'mber_79i64AJ0jktPj'),
  ('plan_P9yx1m1HdHfMt', 'mber_v00W7qR4Tk7Rf'),
  ('plan_Z5Q0zq7doUI8H', 'mber_a3CVXLzqDvnIC'),
  ('plan_HojJOiMximgpU', 'mber_m5qRsc1lDPib3'),
  ('plan_nMoysXDDNVFX5', 'mber_KGwvN0aEKsvKI'),
  ('plan_VtwSdF0ili4RR', 'mber_dS4oxBC6HT2BW'),
  ('plan_lAAuIB5R9olNq', 'mber_mkaRcnjDbmQvl'),
  ('plan_ILH9iXEY59nXv', 'mber_pacOqaWtNWE7R'),
  ('plan_ZUqUmieMhc3Jt', 'mber_THyJh8ERVtuLS'),
  ('plan_uq3mHMao2PdJd', 'mber_GEY5Np7BL8fBD'),
  ('plan_WWe9isrBcd1yC', 'mber_7kWmGe9cmN87s'),
  ('plan_MHrMF9QLJFRlT', 'mber_JYWbbYptpk5R2'),
  ('plan_kh0Fwr3Gzqd7V', 'mber_qaLQHIZGdZjel'),
  ('plan_4T2BdebR7kjOr', 'mber_r4sPH3ILbhSu0'),
  ('plan_MbIUokwVaRdvI', 'mber_H1aLPCc5alW8H'),
  ('plan_WqeQb3grh85IA', 'mber_KOx1qNYwcBdAj'),
  ('plan_X7Ct1PSsPacD5', 'mber_OZ7uuoQY7wkz6'),
  ('plan_hzTkvJG5W89D0', 'mber_m6ft525ATgP7f'),
  ('plan_fNQM9Wynz4aLJ', 'mber_7Rc7ku8F3RJFa'),
  ('plan_0Tr7x6QQfTl48', 'mber_s1UgEB27uBS0e'),
  ('plan_ADzbRgoxjJzli', 'mber_EtvrO7KBi3lEM'),
  ('plan_PkrT0TVbHq3jd', 'mber_J5fmbGZgBOaUn'),
  ('plan_9eRq0claiXmyw', 'mber_ahp5vxgsp0DZ8'),
  ('plan_TahqfxtXVC6fp', 'mber_iKKCVNbdHQbIo'),
  ('plan_XyKcDksXcVjsd', 'mber_o9hw8KtZ4roXk'),
  ('plan_DqkGno35H293i', 'mber_kZEsR8yqNUQvg'),
  ('plan_An2AlL8GP4i0i', 'mber_RQucVlxFeFabm'),
  ('plan_AYHbY5JP83DQb', 'mber_eFXtX99FV2hZw'),
  ('plan_3EIlU7kctt4z1', 'mber_xaM82IWGOR0E6'),
  ('plan_byuztLSC6fN8S', 'mber_zmBQotRRU5wJc'),
  ('plan_xH8UNHdMcObsr', 'mber_RQucVlxFeFabm'),
  ('plan_E13y2PhTFOIyr', 'mber_PYOba29FQiOI9'),
  ('plan_vntYA7KdX5bco', 'mber_hr6MOsnYZOgGz'),
  ('plan_sExSki4zAA43x', 'mber_Zg5YBq7bkJ2UU'),
  ('plan_OwCBR0pk911j9', 'mber_AivFXMXTmOLdW'),
  ('plan_EShDNGJJfpcZm', 'mber_DHfXUaw40rPXm'),
  ('plan_Maamjiz9ydpkl', 'mber_45nRG2SP3iGzN'),
  ('plan_RaPNfn0zWTI8B', 'mber_zG4AaFIE1aPMM'),
  ('plan_5SgpK7Hy3dNdA', 'mber_goJzEiHDaqpH2'),
  ('plan_NXtYxddZ1bP8g', 'mber_IZZIwrb8517xc'),
  ('plan_1676bOKoqlZ5i', 'mber_vtXJuR7sajs3q'),
  ('plan_4mwqoMDuN15bW', 'mber_OwdwOoSKJpW0s'),
  ('plan_2e0xMJlW45lKo', 'mber_svLHA7erAkOT7'),
  ('plan_QdEQ6BVrdCPsK', 'mber_ReNK0zDba9ECG'),
  ('plan_V1ZbmVkttXJvt', 'mber_T2jq1g4IKXwLV'),
  ('plan_Q1jIqsa09z4WZ', 'mber_JgtuXb11GccsG'),
  ('plan_t6HVKeMakRPwk', 'mber_53bk1VegpyO3R'),
  ('plan_lPz8mdQX1TWZL', 'mber_4deo2MfA9UuIV'),
  ('plan_uKzpHuszxAATO', 'mber_nLfvPQwxg0rBm'),
  ('plan_zoK1vzldwE89R', 'mber_nkBfvXw5F6rAw'),
  ('plan_zC6J4HCm6KUu7', 'mber_Z0SlGkv0PMa7t'),
  ('plan_jPaffhcg68mNK', 'mber_wrMzLnjRg9vqj'),
  ('plan_9ytRSlY7ZmM74', 'mber_2qnuxH4gBHaeg'),
  ('plan_76l1PrXQoFjhF', 'mber_rP5F04ny5BaQn'),
  ('plan_ch9nVtyKICHal', 'mber_XzTp0ppkSnYRE'),
  ('plan_wrP6hbw13xmC7', 'mber_NJH7QZATjyBEH'),
  ('plan_U9KkZ01c3OZa5', 'mber_up1mvVq531GKL'),
  ('plan_H3Y2av4w2zGBI', 'mber_XKtNkEciHE3OI'),
  ('plan_P6lJykvMhdTNm', 'mber_nwwxxJNcEvICg'),
  ('plan_VjUu79ZtkaEL2', 'mber_silNl8sWIHCBE'),
  ('plan_hisBWFe9ewtf3', 'mber_D22FPpMiRTPed'),
  ('plan_XvfE8d7N38EGH', 'mber_9nqAXHUWlJhKW'),
  ('plan_7BGdfmgZHGNwV', 'mber_ZUifBG5XqZWHj'),
  ('plan_QAJToQpdS8EoJ', 'mber_GMyR8DCD843VV'),
  ('plan_osXySeuyMDaYe', 'mber_djTPsD29oOKk3'),
  ('plan_cT6ZxQArLYyYk', 'mber_mBuHybbMcxieK'),
  ('plan_FLnlNIG8WNRMV', 'mber_wGgU6VJSjJmgT'),
  ('plan_kGj27GoNQoKny', 'mber_UgxHrqtFxUfrr'),
  ('plan_qXQwpg4WAPKWr', 'mber_dFgyJz8BNAu9l'),
  ('plan_6JDhs1ZffHzmV', 'mber_WBOm7DgfZtspT'),
  ('plan_psFj9fwGz3671', 'mber_rRHa6G3BhtXMB'),
  ('plan_6AxfjelL6dO2y', 'mber_LwPNbS294Mxuz'),
  ('plan_NYS1jozoGF5WD', 'mber_RDBBsjXFCJ0AC'),
  ('plan_GYRxx2eTUdSAk', 'mber_n59MJbVNotMqU'),
  ('plan_CAaiVG83py5E7', 'mber_2SuDKoZp4Ceq7'),
  ('plan_N5K9K58LP5Rvc', 'mber_2ngmFSgbnX2Qa'),
  ('plan_rRQLCFdX0o6mG', 'mber_7zSbsxndDeSaJ'),
  ('plan_d7dZVtaJYXXrb', 'mber_qnndo2yPSBS2x'),
  ('plan_WruVxFGoLPgjY', 'mber_Q3a1xDlRuKW3z'),
  ('plan_45anP8ps1S1sZ', 'mber_rdOU3tmCg6wzt'),
  ('plan_j2Md8Z8CQRGW8', 'mber_xEZYOXhLmEOjL'),
  ('plan_vMmCSppidxmSM', 'mber_q3HC5V1qjx8Nh'),
  ('plan_P19qNL0uf7jZn', 'mber_ItY4Ihi8YaKXi'),
  ('plan_uCkGzk9EUTKzd', 'mber_CQoQkYTz9NZjz'),
  ('plan_Xrk0bckgtFnMm', 'mber_ljMAcssaQglIE'),
  ('plan_ibr2D69uN6LiE', 'mber_0eFqoiXlOr7xt'),
  ('plan_lI8ZAcqhd3kWS', 'mber_byJ2ZhUQXPV5o'),
  ('plan_iGDsFOLZDTaSM', 'mber_kXN9oFKCXuy5i'),
  ('plan_NvKz50OCrNNCP', 'mber_pDHSgLHvg8r9R'),
  ('plan_sCR0hJD35fELA', 'mber_i3D3VcNC7Y5X6'),
  ('plan_IoIhe2A7NFDeB', 'mber_zKsGQqolkSs7n'),
  ('plan_TEyKV3Emq3Xei', 'mber_Gys6wp57rCMjg'),
  ('plan_W7S1IboWKjeox', 'mber_zHpLsP6RrviWC'),
  ('plan_eX720SkgvgzqQ', 'mber_ltaIhzzIkrR0b'),
  ('plan_4Jq7RwK976B4P', 'mber_q4jfIgZMLvGYW'),
  ('plan_RYAxmBSzcZROT', 'mber_aehN8z2UCauMw'),
  ('plan_YuFUjreYk7a81', 'mber_EVfHQPqdQOD1c'),
  ('plan_QkX7kzvIsviPi', 'mber_TOvVxvtloCR99'),
  ('plan_8HUsF795Qk9Ua', 'mber_epB2XTfPD4o44'),
  ('plan_ZNsy3yt2W4H52', 'mber_22Sd0zkslx6UB'),
  ('plan_mh9CrrntUJwyP', 'mber_UjWfaCFoaK66s'),
  ('plan_Ts2dgX17FoeG6', 'mber_czhAPRwJYlS6S'),
  ('plan_wdwaThQj98uHq', 'mber_JPTyqdqwwnl95'),
  ('plan_AIrVCYxJEdmbk', 'mber_LUZNA4kp3O3xq'),
  ('plan_1LCF8EM3CeZmT', 'mber_4hffdnCHI3C43'),
  ('plan_60HhguMHms9pF', 'mber_tSBka4Zlc1O3M'),
  ('plan_oUJCqcZE81CZs', 'mber_oU8gF89AiWckW')
) as v(plan_id, mber)
where t.plan_id = v.plan_id and t.owner_member_id is null;
