# Ship Review (Gate 3) — Auth lock steal (v85.10)

**Date:** 2026-08-27
**Route in:** `/quick-fix`. Second gate of the same incident; the first is
`ship_review_2026-08-27_auth-error-legibility.md` (v85.9), which made this
bug visible rather than fixing it.
**Trigger:** blast-radius router — someone other than you depends on it.

---

## Blast radius

**100% of student logins**, same as v85.9. `AuthProvider` is in the root
layout and `auth/complete` is the only post-OAuth path. No schema, no
migration, no write path. Admin login untouched.

**What this fix is:** removal of a deterministic failure. Any login whose
`setSession` round-trip exceeded 5s failed outright. Full mechanism in
CONTEXT.md under "The auth lock steal."

---

## What breaks?

| # | Failure mode | Assessment |
|---|---|---|
| 1 | **Something on `/auth/complete` needs auth state and now doesn't get it.** | Checked: the page is self-contained, does not call `useAuth`, and hard-redirects on completion (`window.location.href`), which remounts the provider clean on `/dashboard`. `loading` stays `true` on that route but has no consumer there. |
| 2 | **`usePathname()` in a root-layout provider changes render/prerender behaviour.** | `AuthProvider` was already `"use client"`. Build output unchanged — `/auth/complete`, `/login`, `/dashboard` still prerender as static. `isSessionHandoff` is a boolean, so the effect re-runs only when crossing into/out of that route, not on every navigation. |
| 3 | **Retry masks a genuine error.** | Retry is gated on lock contention only (`name.includes("LockAcquireTimeout")` or `/stole it\|acquire timeout/i`). A bad token or dead host returns on the first attempt. |
| 4 | **Cross-tab contention still possible.** | Web Locks are **per-origin, not per-page**. A second tab on the app can still steal. The retry covers it; it is not a guarantee. **Residual, accepted.** |
| 5 | **Budget raised 15s → 20s** to cover the retry. | A genuinely hung call now spins 5s longer before reporting. The "Start over" link still appears at 5s, so the student always has an exit. |
| 6 | **The `/auth/complete` handoff still exists at all.** | The whole `pending_session` cookie → client `setSession` dance is the reason this bug class exists. Proper fix is server-side cookie setting via `createServerClient` and deleting the route. **Not done — needs `/prd`.** |

**Idempotency:** no writes added. Retry re-runs `setSession`, which is
idempotent (it sets the same tokens).

---

## Who notices?

Unchanged from v85.9: students notice, nobody is alerted. What v85.9 bought
is that the student's own screenshot now names the branch — which is exactly
how this root cause was found, in one screenshot, after five rounds of
guessing. **That worked.**

---

## What's the fallback?

Retry (2 attempts) handles transient contention. Past that, the student sees
`session_failed` with the real reason and can start over. If the lock is
being stolen by another tab, closing the other tab resolves it — but nothing
tells them that.

---

## What's the contingency?

Vercel → Deployments → previous deployment → **Promote to Production.**
One step, no rebuild. `git revert` is the slower alternative. Reverting
returns to v85.9, which is visible-but-broken, not silent-and-broken.

---

## How do we fix it?

1. Sign in yourself. If the happy path is broken, roll back immediately —
   this is the login path for everyone.
2. If a student reports `session_failed — client: Lock "..." stole it`
   again, the contender is another tab, not `AuthProvider`. Ask them to
   close other tabs on the app; escalate to the `/prd` fix (#6 above).
3. Vercel logs won't help here — this failure is entirely client-side. The
   login screen's own error line is the diagnostic.

---

## Holes & dispositions

| # | Hole | Disposition |
|---|---|---|
| R6 | Cross-tab lock contention still possible | **Accept** — retry mitigates, per-origin locks can't be fully avoided without #6 |
| R7 | `/auth/complete` handoff architecture retained | **Accept for now** — real fix is `/prd`-scoped (server-side cookies, delete the route). Logged |
| R1-R5 | Carried from v85.9 | **Accepted** 2026-08-27 |

---

## Pre-flight

- **Idempotency** — N/A, no writes. ✅
- **Reversibility** — one-step Vercel rollback. ✅
- **Monitoring** — none. ❌ (R2, previously accepted)
- **Bulk ops** — none. ✅
- **Build** — `tsc` exit 0, `npm run build` exit 0, lint adds nothing new. ✅
- **Runtime verification** — ❌ **NOT DONE in the build session.** OAuth needs
  live Whop credentials with the production redirect URI; localhost cannot
  complete it.

---

## Go-live

Pushed to `main`; Vercel deploys from there.

**Smoke test — run after the deploy shows Ready, not before:**

1. **Sign in as a working account.** Confirm `/dashboard`. This is the one
   that matters; it covers every other student.
2. Watch how long "Signing you in…" is on screen. It should be noticeably
   shorter than before — the lock fight was part of the slowness.
3. Then the affected student. If it works, root cause confirmed in
   production. If it fails, the error line names the next thing.

Not shipped until step 1 passes live.
