"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

export default function AuthCompletePage() {
  useEffect(() => {
    const supabase = createClient();

    // Read the pending session from the cookie
    const cookies = document.cookie.split("; ");
    const pendingCookie = cookies.find((c) => c.startsWith("pending_session="));

    if (!pendingCookie) {
      window.location.href = "/login?error=session_failed";
      return;
    }

    try {
      const sessionData = JSON.parse(
        decodeURIComponent(pendingCookie.split("=").slice(1).join("="))
      );

      supabase.auth
        .setSession({
          access_token: sessionData.access_token,
          refresh_token: sessionData.refresh_token,
        })
        .then(({ error }) => {
          // Clear the temporary cookie
          document.cookie =
            "pending_session=; path=/; max-age=0; SameSite=Lax";

          if (error) {
            window.location.href = "/login?error=session_failed";
          } else {
            window.location.href = "/dashboard";
          }
        });
    } catch {
      window.location.href = "/login?error=session_failed";
    }
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
      </div>
    </div>
  );
}
