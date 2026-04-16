"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { motion } from "framer-motion";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const detail = searchParams.get("detail");

  const errorMessages: Record<string, string> = {
    no_membership: "Active EcomTalent membership required.",
    session_expired: "Session expired. Try again.",
    state_mismatch: "Security check failed. Try again.",
    auth_failed: "Authentication failed. Try again.",
    callback_failed: "Something broke. Try again.",
    session_failed: "Couldn't create your session. Try again.",
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-5">
      {/* Background glow */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, var(--color-accent-glow) 0%, transparent 65%)",
          opacity: 0.4,
        }}
      />

      <div className="relative w-full max-w-[440px]">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.08, delayChildren: 0.05 },
            },
          }}
          className="text-center sm:text-left"
        >
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 8 },
              visible: { opacity: 1, y: 0 },
            }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mono-label-accent mb-3"
          >
            EcomTalent · 30-Day Sprint
          </motion.div>

          <motion.h1
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 },
            }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="display-heading text-[48px] sm:text-[64px] leading-[0.92] mb-4"
          >
            You&apos;re
            <br />
            <span className="text-[var(--color-accent)]">in.</span> Let&apos;s go.
          </motion.h1>

          <motion.p
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 },
            }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-[15px] leading-relaxed text-[var(--color-text-secondary)] mb-8 max-w-[360px] mx-auto sm:mx-0"
          >
            Sign in with Whop. Your 30 days start the moment you&apos;re in.
          </motion.p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-6 px-4 py-3 rounded-xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30"
            >
              <p className="text-[14px] text-[var(--color-danger)]">
                {errorMessages[error] || "Something broke. Try again."}
              </p>
              {detail && (
                <p className="mt-1 text-[11px] text-[var(--color-danger)]/70 break-all font-mono">
                  {detail}
                </p>
              )}
            </motion.div>
          )}

          <motion.div
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 },
            }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <a
              href="/api/auth/whop/authorize"
              className="
                inline-flex items-center justify-center w-full
                px-6 py-4 rounded-xl
                bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)]
                text-[var(--color-bg-primary)] font-semibold text-[16px]
                transition-colors
              "
            >
              Sign in with Whop
            </a>
          </motion.div>

          <motion.p
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1 },
            }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 mono-label text-center sm:text-left"
          >
            <a
              href="/admin/login"
              className="hover:text-[var(--color-text-primary)] transition-colors"
            >
              Team login →
            </a>
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
