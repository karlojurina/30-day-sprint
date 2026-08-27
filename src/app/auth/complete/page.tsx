"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

/** How long setSession gets before we call it dead. A healthy round-trip
 *  is well under a second. This exists because setSession does NOT reject
 *  when the auth host is unreachable — it just never settles, and the page
 *  sat on the spinner indefinitely (student stuck 30 min, 2026-08-25). */
const SESSION_TIMEOUT_MS = 15_000;
/** When to admit on screen that this is taking longer than it should, and
 *  give the student a way out instead of a spinner that tells them nothing. */
const SLOW_NOTICE_MS = 5_000;

/** Every failure path leaves with a code AND a detail, so a screenshot of
 *  the login screen is enough to route the ticket. */
function failToLogin(code: string, detail?: string): void {
  const query = detail
    ? `?error=${code}&detail=${encodeURIComponent(detail.slice(0, 200))}`
    : `?error=${code}`;
  window.location.href = `/login${query}`;
}

export default function AuthCompletePage() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const slowTimer = setTimeout(() => setSlow(true), SLOW_NOTICE_MS);

    // Read the pending session from the cookie
    const cookies = document.cookie.split("; ");
    const pendingCookie = cookies.find((c) => c.startsWith("pending_session="));

    if (!pendingCookie) {
      clearTimeout(slowTimer);
      // The handoff cookie is set with maxAge 60 in the OAuth callback.
      // Arriving here without it almost always means the student reloaded
      // this page after it expired, not that the callback failed.
      failToLogin(
        "session_expired",
        "handoff cookie missing or expired (60s limit)"
      );
      return;
    }

    try {
      const sessionData = JSON.parse(
        decodeURIComponent(pendingCookie.split("=").slice(1).join("="))
      );

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(slowTimer);
        failToLogin(
          "session_timeout",
          `no response from auth host after ${SESSION_TIMEOUT_MS / 1000}s`
        );
      }, SESSION_TIMEOUT_MS);

      supabase.auth
        .setSession({
          access_token: sessionData.access_token,
          refresh_token: sessionData.refresh_token,
        })
        .then(({ error }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          clearTimeout(slowTimer);

          // Clear the temporary cookie
          document.cookie =
            "pending_session=; path=/; max-age=0; SameSite=Lax";

          if (error) {
            failToLogin("session_failed", `client: ${error.message}`);
          } else {
            window.location.href = "/dashboard";
          }
        })
        .catch((err: unknown) => {
          // setSession rejects (rather than resolving with an error) when
          // the request itself fails — DNS, TLS, blocked host. Before this
          // branch existed the rejection was unhandled and nothing moved.
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          clearTimeout(slowTimer);
          failToLogin(
            "session_failed",
            `client: ${err instanceof Error ? err.message : String(err)}`
          );
        });
    } catch (err) {
      clearTimeout(slowTimer);
      failToLogin(
        "session_failed",
        `client: unreadable handoff cookie — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
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
