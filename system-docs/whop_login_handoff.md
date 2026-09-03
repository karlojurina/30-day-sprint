# Whop Student Login — Integration Handoff

You're building an app for EcomTalent students. Students log in with their **Whop account** (the same one they bought the course with) — no separate signup, no passwords. This doc has everything you need to implement it, plus exactly what to send back to Lovro so he can issue your credentials.

Written 2026-07-14. Source: the live EcomTalent sprint platform, which runs this exact flow in production.

---

## FOR THE IMPLEMENTING CLAUDE — READ THIS FIRST

Your job has two phases:

**Phase 1 (do now, before you have any credentials):**
1. Decide your app's OAuth **redirect URI** (the callback route, e.g. `https://yourapp.com/api/auth/whop/callback`). Use the final production domain — a wrong URI means Whop rejects every login.
2. Build the **webhook endpoint** route (e.g. `https://yourapp.com/api/webhooks/whop`) — it can be a stub that just verifies signatures and logs for now, but the URL must be live and stable.
3. Scaffold the OAuth flow per the spec below (it can't complete without credentials, but everything else can be built and unit-tested).
4. **Output the reply template at the bottom of this doc, filled in, for your human to send to Lovro.** Do not skip this — Lovro cannot create your credentials without it.

**Phase 2 (after Lovro sends credentials back):**
5. Put the 4 secrets in env vars, finish the flow, test a real login with a live student account, test the webhook with Whop's "send test event" button.

---

## The credential exchange

| Direction | What | Notes |
|-----------|------|-------|
| **You → Lovro** | OAuth redirect URI | Exact URL, https, production domain |
| **You → Lovro** | Webhook endpoint URL | Exact URL, https, publicly reachable |
| **Lovro → You** | `WHOP_CLIENT_ID` + `WHOP_CLIENT_SECRET` | A new OAuth app created for your app in the Whop dashboard |
| **Lovro → You** | `WHOP_API_KEY` | Admin key, scoped to member reads + membership changes |
| **Lovro → You** | `WHOP_WEBHOOK_SECRET` | Generated when Lovro registers your webhook URL |

Secrets travel over a secure channel (1Password share / one-time secret link), never plain chat. The product and plan IDs are not secret and are printed in this doc.

---

## Access rule — who is allowed in

Only students with an **active paid subscription**. All three conditions, no exceptions:

1. Membership is on product **`prod_eE7r6SXa3H0MX`**
2. Membership's `plan_id` is in the paying allowlist: **`plan_4ZrwR4PmBsVsx`**, **`plan_fMMqxAljrzu75`**
3. Membership has **`valid: true`**

The plan check is NOT optional. There are **free and promo plans on the same product** — a membership on `prod_eE7r6SXa3H0MX` alone does not mean the person paid. Keep the plan allowlist in config, not hardcoded — Lovro will send new plan IDs if paid plans are added later.

Status gotchas (how Whop reports state):
- Trust the **`valid` boolean** over the `status` string. `valid: true` with `status: "past_due"` = billing trouble but still has access — let them in.
- `cancel_at_period_end: true` = student clicked cancel but keeps access until the billing period ends. Don't lock them out early; the `membership.went_invalid` webhook fires when access actually ends.

---

## OAuth login flow (OAuth 2.1 + PKCE)

1. **Authorize:** redirect the student to `https://api.whop.com/oauth/authorize` with `client_id`, your registered `redirect_uri`, `response_type=code`, PKCE `code_challenge` (S256), and `scope=openid profile email`.
2. **Callback:** Whop redirects back with `?code=`. Exchange it at `POST https://api.whop.com/oauth/token` (include the PKCE `code_verifier`, client ID + secret).
3. **Identity:** `GET https://api.whop.com/oauth/userinfo` with the access token → gives `sub` (the Whop user ID, format `user_XXXX`), `email`, `name`, avatar.
4. **Membership gate:** before creating a session, verify the access rule above. Two ways:
   - The student's own token: `GET https://api.whop.com/api/v1/me/memberships` → filter for product + plan + valid.
   - The admin `WHOP_API_KEY` (server-side, more reliable): list the user's memberships and apply the same filter.
5. **Session:** create your user record keyed on the **Whop user ID** (`sub`). That's the stable identity key — emails can change, `user_XXXX` never does.

Re-verify the membership against Whop on **every login**, even with webhooks running. Webhooks keep cached state fresh between logins; the login check is the actual gate. Never grant access from a stale cache alone.

---

## Webhooks — keeping access current between logins

Lovro wants access to end when the subscription ends, so webhooks are part of the build, not optional.

**Events Lovro will subscribe your endpoint to:**

| Event | What you do |
|-------|-------------|
| `membership.went_valid` (a.k.a. `membership.activated`) | Mark the student active (create the record if unknown) |
| `membership.went_invalid` (a.k.a. `membership.deactivated`) | Revoke access / mark canceled |
| `payment.succeeded` | Mark active — self-heals users whose activation event was missed |

Apply the same product + plan filter to webhook payloads — ignore events for memberships that don't match the access rule.

**Signature verification:** Standard Webhooks (Svix) scheme — HMAC-SHA256 over the `webhook-id`, `webhook-timestamp`, `webhook-signature` headers using `WHOP_WEBHOOK_SECRET` (secret may arrive with a `ws_` or `whsec_` prefix). Reject anything unsigned or stale.

**Error handling:** return HTTP **500 on any processing failure** so Whop retries. Returning 200 on a swallowed error silently loses membership changes — that's how apps end up with canceled users still inside.

**Pre-existing students:** webhooks only cover events after registration. Students who subscribed before your webhook existed will be unknown to your DB. Handle this in the OAuth callback: unknown user + valid paying membership → create the record and let them in. (A one-time backfill via the admin API listing all memberships on the product also works, but the callback path is required either way.)

---

## Rate limits

Whop sits behind Cloudflare at roughly 10 req/sec. If you bulk-fetch memberships, throttle to ~5 req/sec and honor `Retry-After` on 429 responses.

---

## What you will NOT get

- The EcomTalent platform's existing keys or secrets — your credentials are fresh and yours alone.
- Access to the EcomTalent database. Your app talks to **Whop directly**; Whop is the single source of truth for membership. If you later need course-progress data from the platform, that's a separate conversation with Lovro.

---

## ✂️ REPLY TEMPLATE — fill in and send to Lovro

> Implementing Claude: fill this in completely and output it as the final deliverable of Phase 1. Both URLs must be live production URLs, not localhost.

```
WHOP LOGIN SETUP — what Lovro needs from us

1. OAuth redirect URI (register on the new Whop OAuth app):
   https://________________________________

2. Webhook endpoint URL (register in Whop dashboard, events:
   membership.went_valid, membership.went_invalid, payment.succeeded):
   https://________________________________

3. Confirmed we will gate access on:
   product prod_eE7r6SXa3H0MX
   + plan in [plan_4ZrwR4PmBsVsx, plan_fMMqxAljrzu75]
   + valid == true
   [yes/no]

4. Preferred secure channel for receiving the 4 secrets
   (client ID, client secret, API key, webhook secret):
   ________________________________
```

**Lovro then:** creates the OAuth app with URI #1 → registers webhook URL #2 with the 3 events → sends back `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET` via channel #4. After that, Phase 2: wire up, log in with a real student account, fire a test webhook event from the Whop dashboard, done.
