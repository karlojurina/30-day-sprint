/**
 * WHOP STATS API - METRIC COMPATIBILITY MATRIX
 *
 * Observed live against account biz_sijEdQzBJ7eVv2 on 2026-09-03 (~1,300 real GET calls).
 * Every field below is measured, not inferred, unless `agg` is a *_INFERRED value or the
 * note says so explicitly.
 *
 * Base: GET https://api.whop.com/api/v1/stats/{key}
 *   ?account_id=biz_sijEdQzBJ7eVv2&from=YYYY-MM-DD&to=YYYY-MM-DD&interval=<interval>[&product=prod_x]
 * Success: { data: { points: [{timestamp:number, value:number|null}], currency?:string, totals?:[{name,value}] } }
 * Failure: { error: { type:string, message:string } }
 *   ...EXCEPT an intermittent HTML 500 page (non-JSON body) - observed 1/6 on
 *   traffic_events&interval=year. Parsers MUST guard JSON.parse.
 */

export type WhopUnit = "currency" | "count" | "percent";

export type WhopInterval =
  | "minute" | "five_minutes" | "thirty_minutes" | "hour"
  | "day" | "week" | "month" | "year";

/**
 * How a bucket at a coarser interval relates to the day-level points inside it.
 * Determined empirically per metric: request interval=month for a full calendar month,
 * then compare that single value against sum(daily) / first(daily) / last(daily).
 */
export type WhopAgg =
  | "FLOW"          // month bucket == SUM of its daily points. Safe to sum across buckets.
  | "LEVEL_LAST"    // month bucket == LAST daily point in the bucket. Never sum.
  | "LEVEL_FIRST"   // month bucket == FIRST daily point in the bucket. Never sum. (MRR/ARR/market_prices)
  | "RATIO"         // recomputed per bucket from num/denom. != sum, != first, != last. Never sum, never average.
  | "UNIQUE"        // deduplicated distinct count. week < sum(days). Never sum.
  | "ROLLING"       // each daily point is itself a trailing-window aggregate. Never sum.
  | "TOTALS_ONLY"   // point.value is meaningless; the number lives in data.totals / point.breakdown
  | "FLOW_INFERRED" // all observed values were 0 or the series was empty; classed by metric family, NOT proven
  | "UNKNOWN";      // no data ever returned on this account; cannot be classified

export type WhopUsable =
  | "yes"       // safe to render as a tile
  | "degraded"  // renderable but with a named caveat
  | "no";       // do not render

export interface WhopMetricSpec {
  key: string;
  unit: WhopUnit;
  agg: WhopAgg;
  /** Intervals that return HTTP 200. */
  intervals: WhopInterval[];
  /** Accepted (200) but SILENTLY returns day-sized buckets. Trap: n looks plausible. */
  degradesToDay: WhopInterval[];
  /** &product=prod_x returns 200. false => 400 "Unsupported parameter(s) for {key}: product". */
  product: boolean;
  /** Params without which the call 400s. */
  requires?: Record<string, string>;
  /** Hard server-side window cap in days, if any. */
  maxWindowDays?: number;
  /** First bucket ever returned for from=2025-02-01 (UTC). null = never any data. */
  historyStart: string | null;
  /** Omits buckets entirely for periods with no activity. */
  sparse: boolean;
  /** value:null observed in >=1 bucket over the full 2025-02-01..2026-09-02 history. */
  nullable: boolean;
  /** data.totals present on a plain (non-breakdown) call. */
  hasTotals: boolean;
  /** Not revenue-relevant for the founder Stats tab. */
  irrelevant: boolean;
  usable: WhopUsable;
  note?: string;
}

const REV: WhopInterval[] = ["hour", "day", "week", "month", "year"];
const ALL8: WhopInterval[] = ["minute","five_minutes","thirty_minutes","hour","day","week","month","year"];
const DAY_ONLY: WhopInterval[] = ["day"];
const NONE: WhopInterval[] = [];

export const WHOP_METRICS: Record<string, WhopMetricSpec> = {
  // ---------- REVENUE FLOWS: the safe core. month == sum(daily), exact to the cent, 19/19 months.
  gross_revenue: { key:"gross_revenue", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Reconciles to sum(products) exactly ($0.00 over Aug 2026). month==sum(daily) exact for all 19 months." },
  checkout_gtv: { key:"checkout_gtv", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Byte-identical to gross_revenue on every window tested. Do not show both." },
  net_revenue: { key:"net_revenue", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  net_volume: { key:"net_volume", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  gross_transaction_value: { key:"gross_transaction_value", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  marketplace_revenue: { key:"marketplace_revenue", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-04-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"277 of 579 day buckets OMITTED (no marketplace sale that day). Gap, not zero." },
  successful_payments: { key:"successful_payments", unit:"count", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  total_refunded: { key:"total_refunded", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  new_users: { key:"new_users", unit:"count", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  product_new_users: { key:"product_new_users", unit:"count", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Aug 2026: 343 acct == 251+24+68+0+0 across the 5 products." },
  page_visits: { key:"page_visits", unit:"count", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-11-25", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"No data before 2025-11-25 (322 omitted days)." },
  balance_activity: { key:"balance_activity", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Can be negative (2026-07 = -3256.67)." },

  // ---------- FEES: all FLOW, all verified month==sum.
  fees: { key:"fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  affiliate_fees: { key:"affiliate_fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  payment_processing_fees: { key:"payment_processing_fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  whop_processing_fees: { key:"whop_processing_fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  dispute_fees: { key:"dispute_fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  marketplace_fees: { key:"marketplace_fees", unit:"currency", agg:"FLOW_INFERRED", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"EVERY value 0.00 across 579 days. sum==first==last==month, so FLOW is inferred from family, not proven." },
  product_fees: { key:"product_fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  product_affiliate_fees: { key:"product_affiliate_fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  product_payment_processing_fees: { key:"product_payment_processing_fees", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },
  product_sales_tax_withheld: { key:"product_sales_tax_withheld", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Reconciles month==sum(daily) for all 19 months, unlike its account-level twin." },
  sales_tax_withheld: { key:"sales_tax_withheld", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"BROKEN AGGREGATE: month bucket != sum(daily) in 4 of 19 months (2025-08 -33.66, 2026-03 -153.42, 2026-05 -21.82, 2026-07 -100.84). Prefer product_sales_tax_withheld." },

  // ---------- DISPUTES / REFUND COUNTS
  disputes: { key:"disputes", unit:"count", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-04-16", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Extremely sparse: 11 non-omitted days in 579. Zero points for Aug 2026." },
  dispute_alerts: { key:"dispute_alerts", unit:"count", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-06-10", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"18 non-omitted days in 579." },

  // ---------- LEVELS: bucket == LAST day. NEVER SUM.
  account_balance: { key:"account_balance", unit:"currency", agg:"LEVEL_LAST", intervals:ALL8, degradesToDay:NONE, product:false, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Only metric accepting all 8 intervals incl. minute. Partial window (Aug10-20) returns the Aug-20 value stamped 2026-08-01." },
  paid_active_members: { key:"paid_active_members", unit:"count", agg:"LEVEL_LAST", intervals:REV, degradesToDay:["hour"], product:false, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"interval=hour returns 200 but DAY buckets (1 point per day)." },
  users_growth: { key:"users_growth", unit:"count", agg:"LEVEL_LAST", intervals:REV, degradesToDay:["hour"], product:false, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Cumulative member total. interval=hour silently degrades to day." },
  users_breakdown: { key:"users_breakdown", unit:"count", agg:"LEVEL_LAST", intervals:["day","week","month","year"], degradesToDay:NONE, product:false, historyStart:"2026-08-23", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"ONLY ~11 DAYS OF HISTORY. from=2025-02-01 returns 11 points starting 2026-08-23. interval=hour 400s with \"Unsupported granularity 'hourly'\"." },

  // ---------- LEVELS: bucket == FIRST day. THE BIGGEST TRAP IN THE API.
  monthly_recurring_revenue: { key:"monthly_recurring_revenue", unit:"currency", agg:"LEVEL_FIRST", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"BUCKET = VALUE ON THE FIRST DAY OF THE CALENDAR PERIOD, not the last. Aug month bucket = 112455.11 = the Aug-1 daily value; the Aug-31 value is 120168.58. Weeks confirm (Aug3-9 bucket == Aug 3). interval=year over 2025-02..2026-09 returns 2025 = 0 because Jan 1 2025 predates the data. ALWAYS read MRR at interval=day and take the last non-null point." },
  annual_recurring_revenue: { key:"annual_recurring_revenue", unit:"currency", agg:"LEVEL_FIRST", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-01", sparse:false, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Exactly MRR x 12 on every point checked. Same FIRST-of-bucket trap." },

  // ---------- RATIOS: recomputed per bucket. Never sum, never average, never sum across products.
  churn_rate: { key:"churn_rate", unit:"percent", agg:"RATIO", intervals:REV, degradesToDay:["hour"], product:false, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"Pre-scaled (23.87 = 23.87%). Aug: month=23.87, sum(daily)=740, last=21. interval=hour silently degrades to day." },
  refund_rate: { key:"refund_rate", unit:"percent", agg:"RATIO", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:true, irrelevant:false, usable:"yes", note:"data.totals=[{name:'refund_rate',value}] IS the correctly recomputed whole-window figure. Use it. Per-product values do not sum to account (76.62+16.67 != 68.25)." },
  dispute_rate: { key:"dispute_rate", unit:"percent", agg:"RATIO", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:true, irrelevant:false, usable:"yes", note:"Proven on 2025-04: sum(daily)=10, last=0, month=0.6452, data.totals=0.6452. Only 9 non-zero days in 19 months." },
  auth_rate: { key:"auth_rate", unit:"percent", agg:"RATIO", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-09-18", sparse:true, nullable:true, hasTotals:false, irrelevant:false, usable:"yes", note:"THE ONLY METRIC WITH value:null OBSERVED ANYWHERE: 2025-09-18, 2025-10-10, 2025-10-22. 241 omitted days before 2025-09-18." },
  average_revenue_per_user: { key:"average_revenue_per_user", unit:"currency", agg:"RATIO", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes", note:"An average, not a flow. Aug: month=160.95, sum(daily)=4697.62, last=118.08." },
  average_revenue_per_subscription: { key:"average_revenue_per_subscription", unit:"currency", agg:"RATIO", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-02-26", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"yes" },

  // ---------- BROKEN / EMPTY
  churned_revenue: { key:"churned_revenue", unit:"currency", agg:"FLOW", intervals:REV, degradesToDay:NONE, product:true, historyStart:"2025-03-06", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"no", note:"DO NOT RENDER. Ignores `from`: from=2026-08-20&to=2026-08-22&interval=day returns 24 points beginning 2026-02-17. Worse, the SAME timestamp returns DIFFERENT values depending on the window (2026-07-18 = 368.6 on a 3-day window, 97.0 on a 1-day window). Not reproducible." },
  trial_conversion_rate: { key:"trial_conversion_rate", unit:"percent", agg:"UNKNOWN", intervals:REV, degradesToDay:NONE, product:true, historyStart:null, sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"no", note:"200 + points:[] for every window and every one of the 5 products over the full 19 months. Cannot be classified." },
  ad_spend: { key:"ad_spend", unit:"currency", agg:"UNKNOWN", intervals:REV, degradesToDay:NONE, product:true, historyStart:null, sparse:true, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"200 + points:[] over the full history and per product." },

  // ---------- TOTALS-ONLY (attribution). point.value is meaningless.
  events: { key:"events", unit:"currency", agg:"TOTALS_ONLY", intervals:REV, degradesToDay:NONE, product:false, requires:{breakdown_by:"metric"}, maxWindowDays:90, historyStart:"2025-02-26", sparse:false, nullable:false, hasTotals:true, irrelevant:false, usable:"degraded", note:"400 without breakdown_by=metric (\"events requires breakdown_by=metric\"); breakdown_by is the ONLY accepted value. EVERY point.value is 0 - the numbers live in point.breakdown[{name:'count'|'value'}] and data.totals. Day interval capped at 90 days." },
  people: { key:"people", unit:"count", agg:"TOTALS_ONLY", intervals:REV, degradesToDay:NONE, product:false, requires:{breakdown_by:"metric"}, maxWindowDays:366, historyStart:null, sparse:true, nullable:false, hasTotals:true, irrelevant:false, usable:"degraded", note:"Returns points:[] at EVERY interval; only data.totals=[{name:'people',value}] is populated (4592 for Aug 1-31, 4304 for Aug 1-28 - a deduplicated unique count, so it shrinks with the window). Capped at 366 days." },
  ad_delivery: { key:"ad_delivery", unit:"currency", agg:"UNKNOWN", intervals:REV, degradesToDay:NONE, product:false, requires:{breakdown_by:"metric"}, maxWindowDays:90, historyStart:null, sparse:true, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"400 without breakdown_by; with it, points:[] at every interval. No ad data on this account." },

  // ---------- TRAFFIC (irrelevant to revenue, but tested)
  traffic_events: { key:"traffic_events", unit:"count", agg:"FLOW", intervals:ALL8, degradesToDay:["five_minutes","thirty_minutes"], product:false, maxWindowDays:30, historyStart:"n/a (30d cap)", sparse:false, nullable:false, hasTotals:false, irrelevant:true, usable:"degraded", note:"Hard 30-day cap (\"Time range cannot exceed 30 days\"); minute capped at 60 minutes. five_minutes/thirty_minutes return 200 but DAY buckets (7-day window -> 7 points). week bucket == sum(days) exactly (24534). interval=year intermittently 500s with an HTML body." },
  traffic_people: { key:"traffic_people", unit:"count", agg:"UNIQUE", intervals:ALL8, degradesToDay:["five_minutes","thirty_minutes"], product:false, maxWindowDays:30, historyStart:"n/a (30d cap)", sparse:false, nullable:false, hasTotals:false, irrelevant:true, usable:"degraded", note:"DEDUPLICATED: week Aug3-9 = 1080 but sum(daily Aug3-9) = 1257. Never sum across buckets. Same 30d / 60min caps and same five_minutes/thirty_minutes day-degradation as traffic_events." },

  // ---------- WALLET / CARD (irrelevant, no data on this account)
  card_spend: { key:"card_spend", unit:"currency", agg:"UNKNOWN", intervals:REV, degradesToDay:NONE, product:false, historyStart:null, sparse:true, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"200 + points:[] over the full 19 months." },
  cashback: { key:"cashback", unit:"currency", agg:"UNKNOWN", intervals:REV, degradesToDay:NONE, product:false, historyStart:null, sparse:true, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"200 + points:[] over the full 19 months." },
  cashback_qualified_spend: { key:"cashback_qualified_spend", unit:"currency", agg:"UNKNOWN", intervals:REV, degradesToDay:NONE, product:false, historyStart:null, sparse:true, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"200 + points:[] over the full 19 months." },
  market_prices: { key:"market_prices", unit:"currency", agg:"LEVEL_FIRST", intervals:["five_minutes","thirty_minutes","hour","day"], degradesToDay:NONE, product:false, requires:{currency:"btc"}, historyStart:"2026-08-02", sparse:true, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"`currency` mandatory and ONLY btc is accepted (case-insensitive); eth/sol/usdc/eur/gbp all 400 \"Unsupported market_prices currency X\". week/month/year/minute 400 with \"market_prices interval must be one of: five_minutes, thirty_minutes, hour, day\". Hour bucket == the FIRST 5-minute value inside it (an open price). Omitted 2026-08-01." },

  // ---------- PARTNER (hard 403 for a company API key)
  partner_earnings: { key:"partner_earnings", unit:"currency", agg:"UNKNOWN", intervals:NONE, degradesToDay:NONE, product:false, historyStart:null, sparse:false, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"403 on EVERY interval and at account level: \"Company API key is not authorized for the stats:read scope.\" Not a scope we can add from the company key." },
  partner_volume: { key:"partner_volume", unit:"currency", agg:"UNKNOWN", intervals:NONE, degradesToDay:NONE, product:false, historyStart:null, sparse:false, nullable:false, hasTotals:false, irrelevant:true, usable:"no", note:"Same 403 as partner_earnings." },

  // ---------- SNAPSHOT FAMILY (13): DAY ONLY. Each daily point is a trailing-window aggregate.
  snapshot_receipts: { key:"snapshot_receipts", unit:"count", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"846 on 2026-08-31 vs 858 successful_payments over the trailing 30 days and 806 over 28 - a rolling ~30-day count, NOT a daily increment. Summing 31 days gives 25155, which is 28x the real number." },
  snapshot_refunds: { key:"snapshot_refunds", unit:"count", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"20 on 2026-08-31; 20/846 = 2.364% = snapshot_refund_rate exactly. Rolling window." },
  snapshot_refund_rate: { key:"snapshot_refund_rate", unit:"percent", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"Pre-scaled. Read the last point only." },
  snapshot_approved_authorizations: { key:"snapshot_approved_authorizations", unit:"count", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded" },
  snapshot_decided_authorizations: { key:"snapshot_decided_authorizations", unit:"count", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"870/1259 on 2026-08-31 = 69.102% = snapshot_auth_rate exactly. Confirms the trio is same-day consistent." },
  snapshot_auth_rate: { key:"snapshot_auth_rate", unit:"percent", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded" },
  snapshot_disputes: { key:"snapshot_disputes", unit:"count", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"All 0 in Aug 2026." },
  snapshot_dispute_rate: { key:"snapshot_dispute_rate", unit:"percent", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"All 0.0 in Aug 2026." },
  snapshot_cohorted_dispute_rate_7d_attr: { key:"snapshot_cohorted_dispute_rate_7d_attr", unit:"percent", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"All 0.0 in Aug 2026." },
  snapshot_cohorted_dispute_rate_14d_attr: { key:"snapshot_cohorted_dispute_rate_14d_attr", unit:"percent", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"All 0.0 in Aug 2026." },
  snapshot_cohorted_dispute_rate_28d_attr: { key:"snapshot_cohorted_dispute_rate_28d_attr", unit:"percent", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded", note:"All 0.0 in Aug 2026." },
  snapshot_resolution_center_cases: { key:"snapshot_resolution_center_cases", unit:"count", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded" },
  snapshot_resolution_center_case_rate: { key:"snapshot_resolution_center_case_rate", unit:"percent", agg:"ROLLING", intervals:DAY_ONLY, degradesToDay:NONE, product:false, historyStart:"2026-06-19", sparse:true, nullable:false, hasTotals:false, irrelevant:false, usable:"degraded" },
};

/** The 23 metrics that accept &product=. Everything else 400s "Unsupported parameter(s) for {key}: product". */
export const WHOP_PRODUCT_METRICS = Object.values(WHOP_METRICS).filter(m => m.product).map(m => m.key);

/** Only these two products carried revenue in Aug 2026; the other three returned 0 on everything except product_new_users (Apex: 68). */
export const WHOP_PRODUCTS = {
  ecomtalent:  "prod_eE7r6SXa3H0MX",
  et_brands:   "prod_bGNf1u02RruKC",
  apex_free:   "prod_vCHZUO8dU4ts2",
  unknown_4:   "prod_8xXRH0itamZoI",
  unknown_5:   "prod_HvtwbgSituEJi",
} as const;

/** Exact server rejection strings, so the route can classify without string-sniffing at runtime. */
export const WHOP_ERROR_STRINGS = {
  productUnsupported: (k: string) => `Unsupported parameter(s) for ${k}: product`,
  intervalMinute:     (k: string) => `${k} is not available by minutely`,
  intervalFive:       (k: string) => `${k} is not available by five_minutes`,
  intervalThirty:     (k: string) => `${k} is not available by thirty_minutes`,
  dayOnly:            (k: string) => `${k} is only available by day`,
  needsBreakdown:     (k: string) => `${k} requires breakdown_by=metric`,
  dayCap90:           (k: string) => `${k} daily interval supports at most 90 days; narrow the window`,
  cap366:             (k: string) => `${k} supports at most 366 days; narrow the window`,
  usersBreakdownHour: `Unsupported granularity 'hourly'`,
  trafficRange:       `Time range cannot exceed 30 days`,
  trafficMinute:      `minute interval supports at most 60 minutes; narrow the window or use a coarser interval`,
  marketPricesCcy:    `currency is required for market_prices`,
  marketPricesBadCcy: (c: string) => `Unsupported market_prices currency ${c.toUpperCase()}`,
  marketPricesIv:     `market_prices interval must be one of: five_minutes, thirty_minutes, hour, day`,
  partnerScope:       `Company API key is not authorized for the stats:read scope.`,
  adDeliveryBreakdown:`ad_delivery requires breakdown_by=metric or one of: age, gender, age_gender, placement, publisher_platform, country, region, device_platform, impression_device`,
} as const;

// ============================================================================
// AGGREGATION — the ONLY place a series collapses to a single number.
//
// Every caller goes through aggregate(). Nothing else in the codebase is
// allowed to sum, average, or index a Whop series. That is deliberate: the
// five verified traps in this API are all bucket-semantics bugs, and one
// choke point is the only way to guarantee they are handled once.
//
// LOAD-BEARING PRECONDITION: `points` are DAY-interval points. The route
// asserts interval === "day" before every Whop call, and all week/month/year
// rollup happens in our code afterwards. This is why LEVEL_FIRST and
// LEVEL_LAST collapse identically here — the FIRST-of-bucket trap
// (MRR month bucket = the 1st, not the 31st) only exists at coarse
// intervals. Feed this coarse points and MRR will be a month stale.
// ============================================================================

export type MetricPoint = { t: number; v: number | null };
export type WhopTotals = { name: string; value: number }[] | undefined;

/** Aggregations that CANNOT be derived from daily points and need data.totals. */
const NEEDS_TOTALS: ReadonlySet<WhopAgg> = new Set<WhopAgg>([
  "RATIO",
  "UNIQUE",
  "TOTALS_ONLY",
]);

/**
 * Collapse a day-interval series to the single number a tile shows.
 * Returns null when the value is genuinely unknowable — never 0 as a stand-in.
 * Throws on an unknown metric key so a typo cannot silently render a blank tile.
 */
export function aggregate(
  key: string,
  points: MetricPoint[],
  totals?: WhopTotals,
): number | null {
  const spec = WHOP_METRICS[key];
  if (!spec) {
    throw new Error(
      `aggregate: unknown Whop metric "${key}". Add it to WHOP_METRICS after probing it live.`,
    );
  }

  // data.totals, where the API provides it, is the API's OWN correctly
  // recomputed whole-window figure. For a ratio it is the only right answer:
  // dispute_rate over 2025-04 is 0.6452, while sum(daily) is 10 and
  // last(daily) is 0. Both of those are plausible and both are wrong.
  if (NEEDS_TOTALS.has(spec.agg)) {
    const t = totals?.find((x) => x.name === key) ?? totals?.[0];
    return typeof t?.value === "number" ? t.value : null;
  }

  const nonNull = points.filter((p) => p.v != null) as { t: number; v: number }[];
  if (nonNull.length === 0) return null;

  switch (spec.agg) {
    case "FLOW":
    case "FLOW_INFERRED":
      return nonNull.reduce((s, p) => s + p.v, 0);

    // Both level kinds resolve to the latest observed value, because the
    // precondition above guarantees these are daily points. See the header.
    case "LEVEL_LAST":
    case "LEVEL_FIRST":
    case "ROLLING":
      return nonNull[nonNull.length - 1].v;

    case "UNKNOWN":
      return null;

    default: {
      // Exhaustiveness guard: a new WhopAgg added above without a branch here
      // becomes a compile error rather than a silently wrong number.
      const _never: never = spec.agg as never;
      void _never;
      return null;
    }
  }
}

/**
 * Render a value for display. Percent values from this API are ALREADY
 * scaled (refund_rate 2.282157676348548 means 2.28%, verified exactly as
 * 22/964*100), so there is no scaling factor anywhere in this file and
 * nothing to multiply by.
 */
export function formatMetric(key: string, v: number | null): string {
  const spec = WHOP_METRICS[key];
  if (!spec) throw new Error(`formatMetric: unknown Whop metric "${key}".`);
  if (v == null) return "—";

  switch (spec.unit) {
    case "currency":
      return v.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
    case "count":
      return Math.round(v).toLocaleString("en-US");
    case "percent":
      return `${v.toFixed(2)}%`;
  }
}

/**
 * A percent outside 0-100 means the value was scaled somewhere it should not
 * have been. Turns a believable wrong number into a visible error.
 */
export function percentOutOfBand(key: string, v: number | null): boolean {
  const spec = WHOP_METRICS[key];
  return !!spec && spec.unit === "percent" && v != null && (v < 0 || v > 100);
}

/** Metrics safe to offer in the tile picker: revenue-relevant and renderable. */
export const WHOP_PICKABLE_METRICS: string[] = Object.values(WHOP_METRICS)
  .filter((m) => !m.irrelevant && m.usable !== "no")
  .map((m) => m.key)
  .sort();

/** Metrics deliberately withheld, with the reason, so the exclusion is auditable. */
export const WHOP_WITHHELD_METRICS: { key: string; reason: string }[] =
  Object.values(WHOP_METRICS)
    .filter((m) => m.irrelevant || m.usable === "no")
    .map((m) => ({
      key: m.key,
      reason: m.usable === "no" ? (m.note ?? "not renderable") : "not revenue-relevant",
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

/** Display names, verbatim from GET /api/v1/stats (64 metrics). */
export const WHOP_METRIC_NAMES: Record<string, string> = {
  account_balance: "Total balance",
  ad_delivery: "Ad delivery",
  ad_spend: "Ad spend",
  affiliate_fees: "Affiliate fees",
  annual_recurring_revenue: "ARR",
  auth_rate: "Auth rate",
  average_revenue_per_subscription: "Average revenue per subscription",
  average_revenue_per_user: "Average revenue per user",
  balance_activity: "Balance activity",
  card_spend: "Card spend",
  cashback: "Cashback",
  cashback_qualified_spend: "Cashback qualified spend",
  checkout_gtv: "Checkout GTV",
  churn_rate: "Churn rate",
  churned_revenue: "Churned revenue",
  dispute_alerts: "Dispute alerts",
  dispute_fees: "Dispute fees",
  dispute_rate: "Dispute rate",
  disputes: "Disputes",
  events: "Events",
  fees: "Fees",
  gross_revenue: "Gross revenue",
  gross_transaction_value: "GMV",
  market_prices: "Market prices",
  marketplace_fees: "Marketplace fees",
  marketplace_revenue: "Marketplace revenue",
  monthly_recurring_revenue: "MRR",
  net_revenue: "Net revenue",
  net_volume: "Net volume",
  new_users: "New users",
  page_visits: "Page visits",
  paid_active_members: "Paid active members",
  partner_earnings: "Partner referral earnings",
  partner_volume: "Partner referral volume",
  payment_processing_fees: "Payment processing fees",
  people: "People",
  product_affiliate_fees: "Product affiliate fees",
  product_fees: "Product fees",
  product_new_users: "New product users",
  product_payment_processing_fees: "Product payment processing fees",
  product_sales_tax_withheld: "Product sales tax withheld",
  refund_rate: "Refund rate",
  sales_tax_withheld: "Sales tax withheld",
  snapshot_approved_authorizations: "Approved authorizations",
  snapshot_auth_rate: "Auth rate",
  snapshot_cohorted_dispute_rate_14d_attr: "Cohorted dispute rate (14-day attribution)",
  snapshot_cohorted_dispute_rate_28d_attr: "Cohorted dispute rate (28-day attribution)",
  snapshot_cohorted_dispute_rate_7d_attr: "Cohorted dispute rate (7-day attribution)",
  snapshot_decided_authorizations: "Decided authorizations",
  snapshot_dispute_rate: "Dispute rate",
  snapshot_disputes: "Disputes",
  snapshot_receipts: "Paid receipts",
  snapshot_refund_rate: "Refund rate",
  snapshot_refunds: "Refunds",
  snapshot_resolution_center_case_rate: "Resolution center case rate",
  snapshot_resolution_center_cases: "Resolution center cases",
  successful_payments: "Successful payments",
  total_refunded: "Total refunded",
  traffic_events: "Traffic events",
  traffic_people: "Traffic people",
  trial_conversion_rate: "Trial conversion rate",
  users_breakdown: "Users breakdown",
  users_growth: "Active members",
  whop_processing_fees: "Whop processing fees",
};
