"use client";

import { useEffect, useState } from "react";
import { createClient, isLockContention } from "@/lib/supabase-browser";

/** Overall budget for the handoff. setSession does NOT reject when the auth
 *  host is unreachable — it never settles — so without this the page span
 *  forever (student stuck 30 min, 2026-08-25). Sized to cover the retries
 *  below with room to spare. */
const SESSION_BUDGET_MS = 20_000;
/** When to admit on screen that this is taking longer than it should, and
 *  give the student a way out instead of a spinner that tells them nothing. */
const SLOW_NOTICE_MS = 5_000;
/** setSession holds the auth lock across a network round-trip. Anything else
 *  in this origin that wants the lock waits `lockAcquireTimeout` (5s, see
 *  GoTrueClient) and then STEALS it, killing our call. AuthProvider no longer
 *  competes (it sits this route out), but another open tab still can — Web
 *  Locks are per-origin, not per-page. The thief finishes fast, so a retry
 *  lands cleanly. */
const SET_SESSION_ATTEMPTS = 2;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Every failure path leaves with a code AND a detail, so a screenshot of
 *  the login screen is enough to route the ticket. */
function failToLogin(code: string, detail?: string): void {
  const query = detail
    ? `?error=${code}&detail=${encodeURIComponent(detail.slice(0, 200))}`
    : `?error=${code}`;
  window.location.href = `/login${query}`;
}

type Tokens = { access_token: string; refresh_token: string };

/** Returns null on success, or a human-readable failure reason. */
async function setSessionWithRetry(
  supabase: ReturnType<typeof createClient>,
  tokens: Tokens
): Promise<string | null> {
  let last = "unknown error";
  for (let attempt = 0; attempt < SET_SESSION_ATTEMPTS; attempt++) {
    try {
      const { error } = await supabase.auth.setSession(tokens);
      if (!error) return null;
      last = error.message;
      if (!isLockContention(error)) return last;
    } catch (err) {
      // NavigatorLockAcquireTimeoutError is a plain Error, not an AuthError,
      // so setSession rethrows it instead of returning it in `error`.
      last = describe(err);
      if (!isLockContention(err)) return last;
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return last;
}

export default function AuthCompletePage() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let done = false;

    const slowTimer = setTimeout(() => setSlow(true), SLOW_NOTICE_MS);
    const budgetTimer = setTimeout(() => {
      if (done) return;
      done = true;
      clearTimeout(slowTimer);
      failToLogin(
        "session_timeout",
        `no response from auth host after ${SESSION_BUDGET_MS / 1000}s`
      );
    }, SESSION_BUDGET_MS);

    const clearTimers = () => {
      clearTimeout(slowTimer);
      clearTimeout(budgetTimer);
    };

    void (async () => {
      // Read the pending session from the cookie
      const cookies = document.cookie.split("; ");
      const pendingCookie = cookies.find((c) =>
        c.startsWith("pending_session=")
      );

      if (!pendingCookie) {
        if (done) return;
        done = true;
        clearTimers();
        // The handoff cookie is set with maxAge 60 in the OAuth callback.
        // Arriving here without it almost always means the student reloaded
        // this page after it expired, not that the callback failed.
        failToLogin(
          "session_expired",
          "handoff cookie missing or expired (60s limit)"
        );
        return;
      }

      let tokens: Tokens;
      try {
        tokens = JSON.parse(
          decodeURIComponent(pendingCookie.split("=").slice(1).join("="))
        );
      } catch (err) {
        if (done) return;
        done = true;
        clearTimers();
        failToLogin(
          "session_failed",
          `client: unreadable handoff cookie — ${describe(err)}`
        );
        return;
      }

      const failure = await setSessionWithRetry(supabase, tokens);
      if (done) return;
      done = true;
      clearTimers();

      // Clear the temporary cookie
      document.cookie = "pending_session=; path=/; max-age=0; SameSite=Lax";

      if (failure) {
        failToLogin("session_failed", `client: ${failure}`);
      } else {
        window.location.href = "/dashboard";
      }
    })();

    return () => {
      done = true;
      clearTimers();
    };
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen relative">
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 50%, var(--color-accent-glow) 0%, transparent 65%)",
          opacity: 0.3,
        }}
      />
      <div
        role="status"
        aria-live="polite"
        className="relative text-center space-y-3"
      >
        <div
          aria-hidden="true"
          className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto"
        />
        <p className="mono-label-accent">Signing you in…</p>
        {slow && (
          <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)] max-w-[260px] mx-auto">
            Taking longer than usual.{" "}
            <a
              href="/login"
              className="underline text-[var(--color-text-primary)]"
            >
              Start over
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
