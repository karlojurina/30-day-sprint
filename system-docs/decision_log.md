# Decision Log

Key architectural and product decisions for the EcomTalent platform.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-15 | Deterministic password (HMAC) to bridge Whop → Supabase | Avoids storing Whop tokens; same user always gets same password, so sign-up = sign-in |
| 2026-04-15 | Tasks stored in DB, not hardcoded | Enables SQL joins for progress tracking, discount eligibility, and churn detection |
| 2026-04-15 | day_number computed, never stored | Avoids stale data; always derived from `joined_at` |
| 2026-04-15 | All mutations via API routes (not client-side) | Service role key stays server-side; cleaner security model |
| 2026-04-15 | Direct Whop HTTP calls, no SDK | Whop SDK not mature enough; direct calls give full control over OAuth + PKCE |
| 2026-04-15 | Vercel cron for churn detection | Simple, free, runs daily at 9am; no need for separate worker infrastructure |
| 2026-08-27 | Auth failures always carry a code + detail; both spinner gates get 15s watchdogs (v85.9) | A student sat on `/auth/complete` for 30 min with zero reported information, and five rounds of screenshots still didn't identify the branch. Every auth exit now names itself on screen. Accepted residuals (no failure alerting, double password grant per login, unresolved client-side Supabase reachability) recorded in `ship_review_2026-08-27_auth-error-legibility.md` |
