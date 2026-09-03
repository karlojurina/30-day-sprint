# Whop Stats catalog — all 64 metrics (verified live 2026-09-03)

Uniform interface for every one:

```
GET https://api.whop.com/api/v1/stats/{key}
  ?account_id=biz_sijEdQzBJ7eVv2
  &from=YYYY-MM-DD&to=YYYY-MM-DD   (INCLUSIVE both ends)
  &interval=minute|hour|day|week|month|year
  &product=prod_...                (only if 'product' is in properties)
```

Passing a property a metric does not list returns **400 Unsupported parameter(s)** — never a silent wrong answer. So the tile availability map can be generated from this catalog at runtime.

**21 of 64 carry a `product` property.** Marked ✅ below.

`LEVEL` = point-in-time value, take the LAST point. `FLOW` = accumulates, SUM the points.
Summing a LEVEL metric is the single easiest way to render a number ~30x too large.

| ✅ | key | name | unit | L/F | properties |
|---|---|---|---|---|---|
| ✅ | `dispute_alerts` | Dispute alerts | count | FLOW | product |
| ✅ | `disputes` | Disputes | count | FLOW | product |
|  | `new_users` | New users | count | FLOW | status, access_level, most_recent_action |
|  | `page_visits` | Page visits | count | FLOW | — |
|  | `paid_active_members` | Paid active members | count | LEVEL | — |
|  | `people` | People | count | FLOW | metric, group_by, source, event, attribution_model, country, city, utm_source, hostname, page, device, browser, os |
| ✅ | `product_new_users` | New product users | count | FLOW | product, access_level |
|  | `snapshot_approved_authorizations` | Approved authorizations | count | FLOW | — |
|  | `snapshot_decided_authorizations` | Decided authorizations | count | FLOW | — |
|  | `snapshot_disputes` | Disputes | count | FLOW | card_network, payment_method, dispute_reason |
|  | `snapshot_receipts` | Paid receipts | count | FLOW | card_network, payment_method |
|  | `snapshot_refunds` | Refunds | count | FLOW | — |
|  | `snapshot_resolution_center_cases` | Resolution center cases | count | FLOW | — |
| ✅ | `successful_payments` | Successful payments | count | FLOW | payment_method, product, currency |
|  | `traffic_events` | Traffic events | count | FLOW | event_name, custom_name, event_type, hostname, page, source, device_type, country_code |
|  | `traffic_people` | Traffic people | count | FLOW | hostname, page, source, device_type, country_code |
|  | `users_breakdown` | Users breakdown | count | FLOW | most_recent_action |
|  | `users_growth` | Active members | count | LEVEL | — |
|  | `account_balance` | Total balance | currency | LEVEL | currency, segment |
|  | `ad_delivery` | Ad delivery | currency | FLOW | metric, source, group_by, age, gender, age_gender, placement, publisher_platform, country, region, device_platform, impression_device |
| ✅ | `ad_spend` | Ad spend | currency | FLOW | product |
|  | `affiliate_fees` | Affiliate fees | currency | FLOW | currency |
| ✅ | `annual_recurring_revenue` | ARR | currency | LEVEL | currency, product |
| ✅ | `average_revenue_per_subscription` | Average revenue per subscription | currency | FLOW | payment_method, product, currency |
| ✅ | `average_revenue_per_user` | Average revenue per user | currency | FLOW | payment_method, product, currency |
|  | `balance_activity` | Balance activity | currency | FLOW | currency, category |
|  | `card_spend` | Card spend | currency | FLOW | merchant |
|  | `cashback` | Cashback | currency | FLOW | merchant |
|  | `cashback_qualified_spend` | Cashback qualified spend | currency | FLOW | merchant |
| ✅ | `checkout_gtv` | Checkout GTV | currency | FLOW | payment_method, product, currency |
| ✅ | `churned_revenue` | Churned revenue | currency | FLOW | product |
|  | `dispute_fees` | Dispute fees | currency | FLOW | currency |
|  | `events` | Events | currency | FLOW | metric, group_by, source, event, attribution_model, country, city, utm_source, hostname, page, device, browser, os |
|  | `fees` | Fees | currency | FLOW | currency, fee_type |
| ✅ | `gross_revenue` | Gross revenue | currency | FLOW | payment_method, product, currency |
|  | `gross_transaction_value` | GMV | currency | FLOW | currency, source |
|  | `market_prices` | Market prices | currency | LEVEL | currency |
|  | `marketplace_fees` | Marketplace fees | currency | FLOW | currency |
| ✅ | `marketplace_revenue` | Marketplace revenue | currency | FLOW | payment_method, product, currency |
| ✅ | `monthly_recurring_revenue` | MRR | currency | LEVEL | currency, product |
| ✅ | `net_revenue` | Net revenue | currency | FLOW | product |
|  | `net_volume` | Net volume | currency | FLOW | — |
|  | `partner_earnings` | Partner referral earnings | currency | FLOW | status, account_id, tier, income_source, payment_method, referred_user_id, internal_referrers, earning_partner_id |
|  | `partner_volume` | Partner referral volume | currency | FLOW | status, account_id, tier, income_source, payment_method, referred_user_id, internal_referrers, earning_partner_id |
|  | `payment_processing_fees` | Payment processing fees | currency | FLOW | currency |
| ✅ | `product_affiliate_fees` | Product affiliate fees | currency | FLOW | product, currency |
| ✅ | `product_fees` | Product fees | currency | FLOW | product, currency |
| ✅ | `product_payment_processing_fees` | Product payment processing fees | currency | FLOW | product, currency |
| ✅ | `product_sales_tax_withheld` | Product sales tax withheld | currency | FLOW | product, currency |
|  | `sales_tax_withheld` | Sales tax withheld | currency | FLOW | currency |
| ✅ | `total_refunded` | Total refunded | currency | FLOW | payment_method, product, currency |
|  | `whop_processing_fees` | Whop processing fees | currency | FLOW | currency |
| ✅ | `auth_rate` | Auth rate | percent | FLOW | product |
|  | `churn_rate` | Churn rate | percent | FLOW | — |
| ✅ | `dispute_rate` | Dispute rate | percent | FLOW | payment_method, product |
| ✅ | `refund_rate` | Refund rate | percent | FLOW | payment_method, product |
|  | `snapshot_auth_rate` | Auth rate | percent | FLOW | — |
|  | `snapshot_cohorted_dispute_rate_14d_attr` | Cohorted dispute rate (14-day attribution) | percent | FLOW | card_network, payment_method |
|  | `snapshot_cohorted_dispute_rate_28d_attr` | Cohorted dispute rate (28-day attribution) | percent | FLOW | card_network, payment_method |
|  | `snapshot_cohorted_dispute_rate_7d_attr` | Cohorted dispute rate (7-day attribution) | percent | FLOW | card_network, payment_method |
|  | `snapshot_dispute_rate` | Dispute rate | percent | FLOW | card_network, payment_method |
|  | `snapshot_refund_rate` | Refund rate | percent | FLOW | — |
|  | `snapshot_resolution_center_case_rate` | Resolution center case rate | percent | FLOW | — |
| ✅ | `trial_conversion_rate` | Trial conversion rate | percent | FLOW | product |

## Notes

- **percent metrics are pre-scaled** — a value of 1.6 means 1.6%. Do not multiply by 100.
- **`points[].value` is nullable.** Render null as a GAP, never as 0.
- **Per-product fee metrics exist** and are the answer to the account-only tiles on Karlo's old dashboard:
  `product_fees`, `product_affiliate_fees`, `product_payment_processing_fees`, `product_sales_tax_withheld`.
  The unprefixed `affiliate_fees` / `payment_processing_fees` / `sales_tax_withheld` are account-only.
- **`net_volume`** (Whop fees only, before refunds) is what Whop's dashboard labels "Revenue after Whop fees".
  **`net_revenue`** (after refunds + disputes + all fees) is smaller and IS per-product.
- **`ad_spend` carries a product property** — Whop is holding ad spend data per product.
- MRR/ARR restate retroactively as refunds and disputes land. Verified: Nov 2025 MRR moved exactly $97.00
  (one subscription) between Karlo's screenshot and today; ARR moved exactly 12x that.
- Gross revenue does NOT restate. It matched Karlo's Nov screenshot to the penny ($65,718.97).