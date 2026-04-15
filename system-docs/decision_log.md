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
