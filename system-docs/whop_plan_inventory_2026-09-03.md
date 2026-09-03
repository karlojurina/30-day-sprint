# Whop plan inventory — verified live 2026-09-03

Pulled from `GET /api/v1/plans?account_id=biz_sijEdQzBJ7eVv2` with cursor pagination
(`page_info.end_cursor` → `&after=`), 9 pages, **167 plans total, 46 paid.**

This supersedes `system-docs/whop_login_handoff.md:42-46`, which is wrong.

## The headline

`PAYING_WHOP_PLAN_IDS` in `src/lib/constants.ts:21-24` holds **2** plan IDs.
The account actually has **46 paid plans across 4 products.**

**A hardcoded paying-plan allowlist cannot work for a revenue surface.** The paying plan set
must be read live from Whop (`renewal_price > 0 OR initial_price > 0`) and cached, never
hardcoded. Any plan not recognized goes into a visible "Unclassified" bucket, never dropped.

## prod_bGNf1u02RruKC — "ecomtalent for brands" — 36 plans, 35 PAID

Almost every one is a `quick_link` $997/30d plan. This looks like **one plan generated per
deal/customer**, which is why a static list was never going to hold.

| Price | Period | Count | Visibility |
|---|---|---|---|
| $997 | 30d renewal | 29 | quick_link |
| $997 | 30d renewal | 2 | visible (`plan_uSpqAhp2cSeyy`, `plan_mMFeOEScXw1WQ` — the latter has init $1000) |
| $997 | 30d renewal | 1 | hidden (`plan_WhOj2R9lWsU9q`) |
| $997 | 30d renewal | 2 | archived (`plan_QM9O2ZM2wzsii`, `plan_U7HhrbuJHa1sG`) |
| $697 | 30d renewal | 1 | hidden (`plan_IEvVN8yVu4r17`) |
| $497 | 30d renewal | 1 | archived (`plan_anPPiGiK91VPh`) |
| $997 | one-time | 1 | archived (`plan_J9zHcPFfM9AKW`) |
| $0 | — | 1 | the archived free plan holding 204 valid memberships |

Note the $697 and $497 tiers — for-brands is not a single price point.

## prod_eE7r6SXa3H0MX — "ecomtalent" — 16 plans, 9 PAID

| Plan | Type | Price | Period | Visibility |
|---|---|---|---|---|
| `plan_TQcycixm7Wf3J` | renewal | $970 | 365d | hidden |
| `plan_fMMqxAljrzu75` | renewal | $970 | 365d | visible |
| `plan_VFDntXQf9cYMo` | renewal | $700 | 365d | archived |
| `plan_UoKS5Tjqvp0Cj` | renewal | $97 | 30d | hidden |
| `plan_4ZrwR4PmBsVsx` | renewal | $97 | 30d | visible |
| `plan_zJvFPWeEWM3rv` | renewal | $5 | 30d | archived |
| `plan_BIVTAaTBLVSaD` | renewal | $1 | 30d | hidden |
| `plan_C3T6K4AWQfGkk` | renewal | $1 | 30d | hidden |
| `plan_I9IEFfgsWUVPq` | one-time | $1 | — | hidden |

**There are TWO $97 plans and TWO $970 annual plans.** The allowlist has one of each. Members
on `plan_UoKS5Tjqvp0Cj` and `plan_TQcycixm7Wf3J` are paying customers currently classified as
non-paying platform-wide — they only produce a console warning
(`src/lib/whop-sync-runner.ts:178-192`, UNKNOWN_PLAN_ID).

Annual plans must contribute **$970 / 12 = $80.83** to MRR, not $970.

## prod_vCHZUO8dU4ts2 — "ecomtalent Apex" — 110 plans, 0 PAID

Every one is $0. 554 valid members. Confirms Apex is a free tier, not a revenue product. It
should be excluded from revenue tiles and, if shown at all, shown only as a headcount.

## Two products not previously known about

| Product | Plan | Price |
|---|---|---|
| `prod_8xXRH0itamZoI` | `plan_MmNGTnkCgcEXb` | $1,500 one-time, visible |
| `prod_HvtwbgSituEJi` | `plan_yI1yq9GFZUpsE` | $500 one-time, archived |

Both carry real money. Neither appears anywhere in the codebase. Need naming from Lovro.

Also zero-paid: `prod_ybxXOuA4ftw12`, `prod_jvOjcUpW7t3Yc` ("30 Day Sprint"), `prod_jJOF24nuURw7Q`.

## Consequences for the build

1. **Read paid plans live from Whop, cache, never hardcode.** 46 plans, generated per deal.
2. **One-time plans are revenue but NOT MRR.** 4 paid one-time plans exist ($1,500, $997, $500, $1).
3. **Annual plans normalize to price/12 for MRR.** 3 annual plans exist.
4. **Archived and hidden plans still hold paying members** and must be counted.
5. **`PAYING_WHOP_PLAN_IDS` is materially incomplete for the EXISTING platform too**, independent
   of this build. Members on the second $97 plan are being treated as non-paying right now.
   Separate ticket.

## API mechanics confirmed

- `GET /api/v1/plans?account_id=<biz_>&limit=100` — requires `plan:basic:read`.
- Cursor pagination: `page_info: {start_cursor, end_cursor, has_next_page, has_previous_page}`.
  Next page is `&after=<end_cursor>`. `page`, `cursor`, and `offset` are all silently ignored
  and return page 1 — a paging bug here would fail silently.
- Fields per plan: `id, created_at, updated_at, visibility, plan_type, release_method, currency,
  initial_price, renewal_price, billing_period, product, company_id`.
