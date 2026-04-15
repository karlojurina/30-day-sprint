# Architecture Summary

## Authentication

### Student Auth (Whop OAuth + PKCE)

```
Browser → /api/auth/whop/authorize
  ├─ Generate PKCE code_verifier + code_challenge
  ├─ Store in httpOnly cookie with state
  └─ Redirect to Whop authorization URL

Whop → /api/auth/whop/callback?code=...&state=...
  ├─ Validate PKCE state from cookie
  ├─ Exchange code for Whop access token
  ├─ Fetch user info from Whop /userinfo
  ├─ Verify active membership (WHOP_PRODUCT_ID)
  ├─ Generate deterministic password: HMAC-SHA256(whopUserId, STUDENT_AUTH_SECRET)
  ├─ Create or sign-in Supabase user with that password
  ├─ Upsert student record with Whop profile data
  └─ Set session cookies → redirect to /dashboard
```

**Why deterministic password?** Bridges Whop identity to Supabase auth without storing tokens. Same Whop user always generates the same password, so sign-up and sign-in are the same flow.

### Team Auth (Supabase email/password)

Team members (Karlo, Astrid) sign in at `/admin/login` with email/password. Their `auth.users.id` must match a row in `team_members` table. RLS policies check `team_members` membership for admin access.

---

## Discount Flow

```
Student completes 13/13 required tasks
  └─ DiscountTracker shows "Request Discount" button

Student clicks → POST /api/discounts/request
  └─ Creates discount_requests row (status: pending)

Team sees in /admin/discounts → clicks Approve
  └─ POST /api/discounts/approve
       ├─ Re-validates 13/13 completion
       ├─ Calls Whop API: create promo code (ECOM30-{id[:6]}, 30% off, 1-use, 1-month)
       ├─ Updates discount_requests (status: approved, promo_code stored)
       └─ Falls back to manual code if Whop API fails
```

---

## Churn Detection (Cron)

Runs daily at 9am via Vercel cron (`vercel.json` → `GET /api/cron/check-engagement`).

| Alert Type | Trigger |
|------------|---------|
| `no_tasks_7d` | No task completions in 7+ days |
| `no_activation_14d` | Day 14+ with no AP1 (content engagement) |
| `no_login_5d` | 5+ days since last_active_at |
| `week2_no_start` | Day 8+ with no Week 2 tasks started |

Alerts are deduplicated by `student_id + alert_type`. Team manages them at `/admin/alerts`.

---

## Webhook Handling

`POST /api/webhooks/whop` — HMAC signature verified with `WHOP_WEBHOOK_SECRET`.

| Event | Action |
|-------|--------|
| `membership.activated` | Upsert student (status: active) |
| `membership.went_valid` | Upsert student (status: active) |
| `membership.deactivated` | Update student (status: canceled) |
| `membership.went_invalid` | Update student (status: canceled) |
| `payment.succeeded` | Update student (status: active) |

---

## Data Flow

- **Client → API routes → Supabase:** All mutations go through Next.js API routes using the service role key. No direct client-side writes.
- **Client reads:** Use browser Supabase client (anon key) with RLS. Students see own data, team sees everything.
- **No real-time subscriptions:** Data refreshes via manual fetches / optimistic updates.
