# Ship Review (Gate 3) — Auth error legibility (v85.9)

**Date:** 2026-08-27
**Route in:** `/quick-fix`, not `/build` — there is no PRD or `project_log.md`
for this change, and none was fabricated. This file is the audit surface.
**Trigger:** blast-radius router fired on "someone other than you depends on it."

---

## Blast radius

**Condition fired:** someone other than me depends on it. Secondary exposure to
money/trust — students who paid cannot reach what they paid for if login breaks.

**Who/what is exposed: 100% of student logins.** Every student passes through
`auth/complete` and `AuthContext` on every sign-in. There is no partial
rollout and no second path in. A regression here locks out the entire
active cohort, not a subset.

**What it does NOT touch:** no schema change, no migration, no table contract,
no write path. The edits sit in redirect/error branches and the client session
handoff. Admin login (`/admin/login`, `api/auth/team/login`) is untouched.

---

## What breaks?

| # | Failure mode | Assessment |
|---|---|---|
| 1 | **15s timeout false-positives on a very slow connection.** A student whose `setSession` would have completed at 16-60s now gets bounced to `/login?error=session_timeout` instead of eventually succeeding. | Real regression, narrow band. A healthy round-trip is <1s, so this is 15x margin. Strictly better than the infinite spinner it replaces, *provided retry works* — and retry re-runs the full OAuth, which does work. |
| 2 | **Watchdog didn't guard the whole load.** `.finally(clearTimeout)` fired when `getSession()` settled, but `fetchProfile()` was not returned from the `.then()`, so it ran unguarded — and `fetchProfile` calls `getSession()` again internally. | **Found during this review. Fixed** — single `finish()` terminal path now clears the watchdog only when the whole load completes. |
| 3 | **Unbounded `detail` in redirect URLs.** A long error message could produce an over-long redirect. | **Fixed for the two sites added here** (capped at 200 chars). Three pre-existing sites remain uncapped: `no_membership` (builds a per-membership summary, the longest), `callback_failed`, and the Whop passthrough. Not touched — see residuals. |
| 4 | **Happy path regression.** | Reviewed line by line. On success the flow is unchanged: clear cookie → `window.location.href = "/dashboard"`. The `settled` flag makes the timeout/resolve race single-fire. |
| 5 | **Repeated timeouts burn Supabase auth rate limit.** Each retry costs 2 password grants (see residual R3), so a student in a timeout loop can rate-limit themselves into `session_failed`. | Real, and it compounds with #1. Bounded by the student giving up. |
| 6 | **The underlying problem is not fixed.** A student whose browser cannot reach Supabase still cannot use the platform. | Explicitly out of scope. This change makes the failure *report itself*; it does not repair it. |

**Idempotency:** not applicable — this change adds no writes. Every new code
path is a redirect. Running twice redirects twice.

---

## Who notices?

- **Students notice immediately** and message Karlo/Lovro. That is currently the
  entire detection mechanism.
- **Nothing is alerted.** The callback writes `console.error` to Vercel logs,
  which nobody watches proactively. There is no monitor on auth failure rate.
  `DISCORD_WEBHOOK_URL` exists in env but is not wired to auth events.
  **This is a hole. It is pre-existing, not introduced here.**
- **After this change, the student's own screenshot is the signal** — the login
  screen renders the raw error code unconditionally, so the first report
  carries the branch and the underlying error. That is the point of the change.

**Source of truth drift:** none introduced. No cached state, no second writer.

---

## What's the fallback?

- **Student-side:** retry from `/login`. Full OAuth re-runs. Works for every
  failure mode except an unreachable auth host (#6), which has no fallback —
  that student cannot get in by any path we control.
- **No manual access-granting path exists** for a student the flow can't serve.
  Not built here; would be a separate build.

---

## What's the contingency?

**One-step rollback, both available:**

1. Vercel → Deployments → last known-good deployment → **Promote to Production.**
   Instant, no rebuild, no git operation.
2. `git revert <sha> && git push origin main` — Vercel redeploys from main.

Prefer (1) if students are actively locked out; it is faster and does not wait
on a build.

---

## How do we fix it?

If login breaks after deploy:

1. Confirm scope — try signing in yourself. If `/login` renders and the Whop
   button works, the break is downstream of OAuth.
2. Roll back via Vercel Promote to Production (above). Confirm the previous
   deployment is serving before telling anyone it's fixed — deploy state lags.
3. Vercel logs, filter `/api/auth/whop/callback`, look for `Session creation
   failed:` and `[whop-callback]` lines. Those name the server-side branch.
4. If the break is client-side, the login screen's own error code names it —
   that is what v85.9 exists to provide.

---

## Holes & dispositions

| # | Hole | Disposition |
|---|---|---|
| H1 | Watchdog cleared before `fetchProfile` completed | **Fixed** — `finish()` terminal path, re-verified |
| H2 | Server-side `detail` uncapped | **Fixed** — 200-char cap on both new sites |
| R1 | 15s timeout may false-positive on very slow networks | **Accept** — needs sign-off. Residual is a narrow band, retry recovers, and the alternative is the infinite spinner we are removing |
| R2 | No alerting on auth failure rate; failures are student-reported | **Accept** — pre-existing, out of scope. Follow-up candidate |
| R3 | Two password grants per login doubles rate-limit consumption | **Accept** — pre-existing, out of scope. Separate fix, flagged |
| R4 | Client-side Supabase reachability unresolved | **Accept** — root cause unconfirmed, documented in CONTEXT.md. This change reports it, does not fix it |
| R5 | Three pre-existing uncapped `detail` sites remain | **Accept** — in production since v75 without incident |

**R1-R5 signed off by Lovro, 2026-08-27**, as written and with the contingency
above. Gate cleared.

---

## Pre-flight

- **Idempotency** — N/A, no writes added. ✅
- **Reversibility** — one-step Vercel rollback. ✅
- **Monitoring** — none added. ❌ (R2, accepted)
- **Bulk ops** — none. N/A ✅
- **Build** — `tsc --noEmit` exit 0, `npm run build` exit 0, lint adds nothing
  new to the four changed files. ✅
- **Runtime verification** — ❌ **NOT DONE.** The OAuth flow cannot be exercised
  locally: it needs live Whop credentials with the production domain as the
  registered redirect URI. Localhost is not registered. The changed paths are
  unexercised until deployed.

---

## Go-live

**Status: PUSHED, SMOKE TEST OUTSTANDING.**

- Residuals R1-R5 signed off by Lovro, 2026-08-27.
- Commit `d756d2c` pushed to `main` 2026-08-27 (`be3a82d..d756d2c`).
  Cutover method: Vercel auto-deploy from `main`.
- **Smoke test not yet run.** Until step 1 below passes against the live
  deployment, this change is deployed but unverified. Do not treat it as
  shipped.

**Smoke test (could not be run from the build session):**

1. Sign in as a working student. Confirm you land on `/dashboard`. This is the
   happy path and the one that matters most — it proves nothing regressed.
2. Visit `/login?error=session_timeout&detail=test` directly. Confirm the message
   renders *and* the raw code line shows underneath it.
3. Ask the affected student for one more attempt. Whatever code comes back is
   the answer we've been missing for five rounds.

Do not mark this shipped until step 1 passes against the live deployment.
