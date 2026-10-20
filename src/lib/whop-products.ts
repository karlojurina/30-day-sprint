// login-1 (branch night/login1-main) has its own copy of these 2 ids in whop-members.ts, and its whop-product-setting.test.mjs reads them from src/lib/etfb.ts, so its merge must point that test at this file.

/**
 * The 2 Whop products beside the course (admin rebuild 2, D11). They lived in
 * src/lib/etfb.ts, which went with the Brand Owners page; the values are
 * that file's, unchanged.
 */

/** ETfB for brands: where the brand owners' monthly subscriptions live. */
export const ETFB_PRODUCT_ID = "prod_bGNf1u02RruKC";

/**
 * Apex: where the free team-seat links live. The product also holds the
 * Evolve partner link, so the whole product is never all team seats.
 */
export const TEAM_SEAT_PRODUCT_ID = "prod_vCHZUO8dU4ts2";
