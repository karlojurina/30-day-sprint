"use client";

import { useSearchParams } from "next/navigation";
import { COMING_SOON_MESSAGE } from "@/lib/student-app-gate";
import s from "./login.module.css";

/**
 * The sign-in's error, read from ?error= (and ?detail=). The only part of the
 * login that reads the address, so it alone waits inside the page's Suspense
 * and the rest of the page is in the server's HTML.
 */
export function LoginError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const detail = searchParams.get("detail");

  if (!error) return null;

  // Every code any auth path can emit. Keep this in sync with the
  // `?error=` redirects in api/auth/whop/callback and auth/complete —
  // an unmapped code renders the useless generic fallback below.
  const errorMessages: Record<string, string> = {
    no_membership: "Active Ecom University membership required.",
    session_expired: "That sign-in attempt expired. Start again below.",
    session_timeout:
      "Couldn't reach our servers. Check your connection, then try again.",
    profile_load_failed:
      "Signed in, but we couldn't load your account. Try again.",
    state_mismatch: "Security check failed. Try again.",
    state_invalid: "Security check failed. Try again.",
    missing_params: "Sign-in didn't complete. Try again.",
    access_denied: "Sign-in was cancelled on Whop.",
    auth_failed: "Authentication failed. Try again.",
    callback_failed: "Something broke. Try again.",
    session_failed: "Couldn't create your session. Try again.",
    // The callback while the student app is closed (T-078). The login's
    // layout shows the coming-soon page then, so this line is the fallback.
    app_closed: COMING_SOON_MESSAGE,
  };

  return (
    <div role="alert" className={s.error}>
      <span aria-hidden="true" className={s.errorDot} />
      <div>
        <p className={s.errorText}>
          {errorMessages[error] || "Something broke. Try again."}
        </p>
        {/* The code always renders, detail when we have one. A
            screenshot of this line is enough to route the ticket
            without a round-trip asking the student for logs. */}
        <p className={s.errorCode}>
          {error}
          {detail ? `: ${detail}` : ""}
        </p>
      </div>
    </div>
  );
}
