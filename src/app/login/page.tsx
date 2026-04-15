"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    no_membership: "You need an active EcomTalent membership to access the platform.",
    session_expired: "Your session expired. Please try again.",
    state_mismatch: "Security check failed. Please try again.",
    auth_failed: "Authentication failed. Please try again.",
    callback_failed: "Something went wrong. Please try again.",
    session_failed: "Could not create your session. Please try again.",
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">EcomTalent</h1>
          <p className="mt-2 text-text-secondary">
            Your 30-Day Sprint to becoming an ad creative specialist
          </p>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/20 rounded-lg px-4 py-3 text-sm text-danger">
            {errorMessages[error] || "An error occurred. Please try again."}
          </div>
        )}

        <a
          href="/api/auth/whop/authorize"
          className="inline-flex items-center justify-center w-full px-6 py-3 text-base font-semibold rounded-lg bg-accent hover:bg-accent-dark transition-colors"
        >
          Sign in with Whop
        </a>

        <p className="text-sm text-text-tertiary">
          <a
            href="/admin/login"
            className="hover:text-text-secondary transition-colors underline"
          >
            Team login
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
