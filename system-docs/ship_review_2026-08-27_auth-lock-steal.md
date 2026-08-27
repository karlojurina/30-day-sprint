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

---

# Gate 3, second pass — silent bounce on reload (v85.11)

**Result of v85.10's smoke test:** the affected student **got in**. Lock steal
confirmed fixed in production. But on refresh he was thrown back to `/login`
with **no error shown**, reproducibly, twice.

## What that was

`StudentGuard` redirects to a bare `/login` whenever `isStudent` is false —
and `student` is null both when someone genuinely isn't a student AND when
the profile load failed. `fetchProfile` had **four** silent exits feeding
that: an unguarded `getSession()` (outside the try/catch below it), two bare
`return`s, and a swallowing `catch`. So a broken session rendered exactly
like a normal logout, with nothing to report.

**Two candidates fit the symptom and I could not separate them from the
report:** (a) the v85.9 15s watchdog firing mid-load and bouncing him, or
(b) lock contention on `/dashboard`, where `StudentContext` makes its own
`getSession()` call against the same origin lock. Rather than guess a third
time, this pass fixes the class both belong to and makes whichever one it is
name itself on the next attempt.

## What breaks?

| # | Failure mode | Assessment |
|---|---|---|
| 1 | **A genuine non-student now sees an error code.** | No — `authError` is null on a clean signed-out load, so that path still gets the bare `/login`. Only a *failed* load carries a code. |
| 2 | **`role: "none"` now reports as an error.** | Deliberate. An authenticated user with no `students`/`team_members` row is a real data problem; it previously vanished into a silent bounce. |
| 3 | **Retry masks a real failure.** | `withLockRetry` retries on lock contention only; anything else rethrows on the first attempt. |
| 4 | **Redirect loop** — guard sends to `/login`, which re-mounts the provider, which errors again. | `/login` is outside `StudentGuard`, so the guard does not run there. No loop. |
| 5 | **Watchdog still bounces a genuinely slow client**, now with a code instead of silently. | Residual. If the report comes back `profile_load_failed — auth load timed out after 15s`, the load is too slow and the next fix is the load, not the guard. **That is the diagnostic this pass exists to produce.** |

**Idempotency:** no writes. N/A.

## Who notices / fallback / contingency / how we fix

Unchanged from the v85.10 section above. Rollback is the same one-step
Vercel promote. The student's own screenshot remains the detection channel.

## Holes & dispositions

| # | Hole | Disposition |
|---|---|---|
| H3 | Unguarded `getSession()` in `fetchProfile` | **Fixed** — wrapped, with lock retry |
| H4 | Four silent exits indistinguishable from logout | **Fixed** — every exit returns a reason; guard routes it |
| R8 | Root cause of the reload failure still unconfirmed (watchdog vs `/dashboard` lock contention) | **Accept for now** — this pass makes it self-identify. Next report names it |
| R9 | `StudentContext` still makes its own auth calls against the shared lock | **Accept** — retry mitigates; the structural fix is R7 (`/prd`) |

## Go-live

Pushed to `main`. Same smoke test as above, plus: **have the student log in
and then refresh.** If he stays in, done. If he's bounced, the login screen
now carries the reason — send it over.

