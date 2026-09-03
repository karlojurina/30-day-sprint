# Revenue Stats page — VERIFIED plan

**Date:** 2026-09-03
**Status:** UNBLOCKED. Phase 0 passed. Every claim below verified by live API call.
**Goal:** rebuild the per-product money tracking Whop removed from their dashboard UI, inside
`/admin`, superadmin-only.

---

## 1. Phase 0 result: PASSED

The decisive test was whether Whop's `product=` filter genuinely works at runtime, or is listed
in the catalog but inert. It works, exactly.

```
gross_revenue, 2026-08-01 → 2026-09-01
  ecomtalent      prod_eE7r6SXa3H0MX     $ 81,512.72
  for brands      prod_bGNf1u02RruKC     $ 58,622.68
  Apex            prod_vCHZUO8dU4ts2     $      0.00
                                         ───────────
  sum of products                        $140,135.40
  account total                          $140,135.40
  difference                             $      0.00   ← exact match
```

**History depth: 20 months, back to 2025-02** (first month $1,034). Monthly gross climbs
$13.2k (2025-03) → $137.7k (2026-07). This is a read-through dashboard with full history on day
one, not a start-recording-today one.

## 2. The credential

Two separate Whop permission systems share the same vocabulary, which cost several rounds:

| | App permissions | **Account/Company API key** |
|---|---|---|
| Where | App "30 Day Sprint" → Permissions tab | **Dashboard → Account API Keys** |
| What | Scopes the app *requires*, granted at install (OAuth-style) | Scopes granted directly to one token |
| Governs our key? | **No** | **Yes** |

`WHOP_API_KEY` is a company API key. Scopes now granted on it: `stats:read`,
`payment:basic:read`, `plan:basic:read`, `plan:stats:read`, plus dispute/resolution reads.
`company:balance:read` is still NOT effective (`GET /api/v2/company` → 401) but nothing needs it.

## 3. Verified capability matrix

Measured on `2026-08-04 → 2026-09-03`, `interval=day`. Level metrics show the last point; flow
metrics show the sum.

| Metric | Catalog properties | Account | ecomtalent | for brands |
|---|---|---|---|---|
| `gross_revenue` | payment_method, **product**, currency | $137,998.67 | $77,381.99 | $60,616.68 |
| `net_revenue` | **product** | $111,100.18 | $57,365.15 | $53,735.03 |
| `monthly_recurring_revenue` | currency, **product** | $120,750.58 | $72,197.58 | $48,553.00 |
| `annual_recurring_revenue` | currency, **product** | $1,449,006.96 | $866,370.96 | $582,636.00 |
| `total_refunded` | payment_method, **product**, currency | $2,092.30 | $1,095.30 | $997.00 |
| `product_new_users` | **product**, access_level | 345 | 254 | 24 |
| `paid_active_members` | *(none)* | 894 | ✗ unsupported | ✗ unsupported |
| `net_volume` | *(none)* | $137,386.00 | ✗ unsupported | ✗ unsupported |
| `new_users` | status, access_level, most_recent_action | 493 | ✗ unsupported | ✗ unsupported |

Passing an unsupported property returns a **400 "Unsupported parameter(s)"**, not a silent
wrong answer. Good failure mode — the availability map can be derived from `GET /v1/stats`.

**There is NO plan-level filter on any stats metric.** `plan`, `plan_id` and `plans` all return
400. This matters: for-brands has 35 paid plans (mostly per-deal `quick_link` $997s, plus $697
and $497 tiers). Per-plan breakdown must come from the payments ledger, not from stats.

**Net revenue runs ~19.5% below gross** ($111.1k vs $138.0k). That is real (fees + refunds +
disputes), and it is the number that will look "wrong" next to the Whop dashboard, which shows
`net_volume` (fees only, before refunds). Label carefully.

## 4. The payments ledger

`GET /api/v1/payments?company_id=biz_sijEdQzBJ7eVv2` and `GET /api/v2/payments` both return 200.
**16,131 payments, 1,614 pages at per_page=10.**

A payment row carries 47 fields. The load-bearing ones:

```
id                  pay_doaL43Y7F1YMJL
status / substatus  paid / succeeded
billing_reason      subscription_cycle      ← separates renewal from initial purchase
currency            usd
subtotal / total    97.0 / 97.0
usd_total           97.0                    ← multi-currency normalization, provided
amount_after_fees   89.93                   ← Whop takes ~7.3% on a $97 charge
tax_amount          0.0
refunded_amount     0.0
refunded_at         null
created_at / paid_at / updated_at           ← updated_at enables re-sync of mutated rows
plan                {id: plan_4ZrwR4PmBsVsx, ...}     ← PER-PLAN
product             {id: prod_eE7r6SXa3H0MX, title: "ecomtalent", ...}
membership          {id: mem_..., status: active}
user                {id: user_..., name, username}
promo_code          ← discount attribution
payment_method / card_brand / card_last4
```

This is the actual ledger: per-payment, per-plan, per-product, with fees, refunds, tax and promo
codes itemized.

## 5. Architecture: use BOTH, and make one check the other

**Stats API = the fast path.** Zero storage, full 20-month history, per-product, native interval
and date range. Every tile in the screenshot except per-product paid-active comes straight from
it. Ship this first.

**Payments ledger = the depth.** Ingested into our own table, it gives what stats cannot:
per-plan breakdown, per-deal $997 attribution, promo-code impact, payment-method split, and a
per-product paid-active history reconstructed from `membership` + `billing_reason`.

**And critically: they reconcile each other.** Our ledger-computed gross for a window must equal
`gross_revenue` from the stats API for that window. That automated check is what stops a
plausible-but-wrong number, which is the one failure mode this platform has already lived
(the M2 KPI printed 98% against a real 57% for two months, `CONTEXT.md:212-217`). We are not
relying on care; we are relying on an independent verifier that runs on a schedule.

### Tile rules

- **MRR/ARR are LEVELS, not flows.** Take the last point. Summing daily MRR gives a number ~30x
  too large.
- **Nulls render as gaps, never zero.** `points[].value` is nullable.
- **Annual plans normalize to price/12.** `plan_fMMqxAljrzu75` at $970/365d contributes $80.83,
  not $970. Three annual plans exist.
- **One-time plans are revenue but NOT MRR.** Four paid one-time plans exist.
- **Never hardcode the paying-plan set.** 46 paid plans across 4 products, minted per deal. Read
  live from `GET /v1/plans`, cache, and put unrecognized plans in a visible "Unclassified"
  bucket. See `whop_plan_inventory_2026-09-03.md`.
- **Do not reuse any launch-cohort helper.** `isInLaunchCohort`, `isPayingMember`,
  `isActiveMember`, `ADMIN_STUDENT_JOIN_CUTOFF`, `PAYING_WHOP_PLAN_IDS`,
  `daily_progress_snapshots` — all wrong for a money surface. Their presence in Stats code is
  the code-review fail condition.
- **Three distinct UI states per tile:** a value, "no data in this window", "could not load".
  A failed fetch must never render $0.

### The gate

All 17 `/admin/*` pages are statically prerendered with client-only `TeamGuard`, and every read
RLS policy is `using(public.current_user_is_team())` with no role awareness. A CSM can read any
table an admin page touches. So:

- Page lives at `src/app/admin/stats/`, **outside** the `(authenticated)` group, as a dynamic
  server component. Copy the pattern at `src/app/journal/[studentId]/page.tsx:34-85` — verified
  absent from the prerender manifest.
- Gate on an immutable `team_members.id` in a `SUPERADMIN_USER_ID` env var, never on role
  (`founder` is mutable — any founder can grant it) and never on email (mutable free text).
- The ledger table gets **no team read policy**. Service role only.
- Post-deploy check: `/admin/stats` must NOT appear in `.next/prerender-manifest.json`.

## 6. Phased plan

| Phase | Ships | Size |
|---|---|---|
| ~~0~~ | ~~Prove the data exists~~ | **DONE, passed** |
| 1 | Gate + 4 revenue tiles (gross, net, MRR, ARR) account-level, date range, daily/weekly, sparklines, previous-period deltas. Chart components extracted from `insights/progress/page.tsx` into `components/admin/charts.tsx`. | ~1 day |
| 2 | Per-product filter on the 4 revenue tiles + `product_new_users`; account-level `paid_active_members` and `new_users`, greyed with a stated reason when a product is selected. Availability map data-driven off `GET /v1/stats`. | ~half day |
| 3 | Payments ledger ingest: table, resumable checkpointed backfill of 16,131 rows, incremental cron using `updated_after` to catch refunds/disputes. | ~1 day |
| 4 | Per-plan breakdown, promo-code attribution, per-product paid-active history, payment drilldown. Plus the automated ledger-vs-stats reconciliation check. | ~1 day |

## 7. Still needed from Lovro

1. **`team_members.id` UUID for the superadmin.** `select id, email, role from team_members
   order by created_at;` Also: how many rows have `role='founder'`?
2. **Should Lovro see the page too, or only Karlo?** One UUID or two.
3. **What are `prod_8xXRH0itamZoI` ($1,500 one-time) and `prod_HvtwbgSituEJi` ($500 one-time)?**
   Real money, absent from the codebase.
4. **Include Apex?** 110 plans, all $0, 554 members. Revenue $0. Headcount-only, or hide it.
5. **"Net revenue" label.** `net_revenue` ($111.1k, after refunds+disputes+fees, per-product) vs
   `net_volume` ($137.4k, Whop fees only, no product filter — this is what Whop's dashboard
   shows). Recommend `net_revenue` with the definition printed on the card.
6. **Timezone.** Whop buckets UTC by default; snapshot-class metrics reject `time_zone`. All
   existing admin date maths is hardcoded UTC. Recommend UTC.
7. **Production `WHOP_PRODUCT_ID`** from Vercel — local holds PLAN ids in a `product_id` param
   and Whop silently returns the whole company (8,083 memberships) for an unrecognized value.
   Separate live bug.
8. **Rotate the API key** when this is done. It was read from `.env.local` and used for this
   research.

## 8. Known live bug found on the way

`PAYING_WHOP_PLAN_IDS` (`src/lib/constants.ts:21-24`) holds 2 of 46 paid plans. Members on the
second $97 plan (`plan_UoKS5Tjqvp0Cj`) and second $970 annual (`plan_TQcycixm7Wf3J`) are
classified as **non-paying platform-wide right now** — silent except a console warning at
`src/lib/whop-sync-runner.ts:178-192`. Affects existing admin metrics, not just this build.
Separate ticket.
