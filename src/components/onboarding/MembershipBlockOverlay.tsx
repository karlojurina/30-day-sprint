"use client";

/**
 * MembershipBlockOverlay - hard gate for students whose subscription
 * isn't active.
 *
 * Mounts above the dashboard surface and blocks all interaction with
 * the map / playbook when student.membership_status is anything other
 * than "active" (i.e. "canceled" | "past_due" | "expired").
 *
 * Per Karlo: "Of course if they don't have an active subscription
 * they shouldn't be able to access." Two escape hatches:
 *   1. Renew → opens Whop checkout in a new tab
 *   2. Sign out → drops the session, returns to /login
 * No close button. No dismissable state.
 *
 * Copy is intentionally one message for all 3 non-active statuses
 * per Karlo's call (simpler than per-status variants).
 */

import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";

const RENEW_URL = "https://whop.com/checkout/plan_4ZrwR4PmBsVsx";

export function MembershipBlockOverlay() {
  const { student, signOut } = useAuth();

  if (!student) return null;
  // Only block when the membership isn't active. The 3 non-active
  // statuses (canceled, past_due, expired) all get the same message.
  if (student.membership_status === "active") return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(8,12,22,0.96) 0%, rgba(4,8,16,0.99) 100%)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        padding: 16,
      }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: "relative",
          width: "min(480px, 100%)",
          padding: "32px 32px 28px",
          background: "rgba(15, 17, 21, 0.96)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 18,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.60), 0 1px 0 rgba(255,255,255,0.05) inset",
          color: "rgba(255,255,255,0.94)",
          overflow: "hidden",
        }}
      >
        {/* Top sheen */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 80,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 100%)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            Subscription not active
          </p>

          <h2
            style={{
              fontSize: 24,
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: "-0.022em",
              color: "rgba(255,255,255,0.96)",
            }}
          >
            Hey {student.name?.split(" ")[0] ?? "there"}, your subscription isn&rsquo;t active right now.
          </h2>

          <p
            style={{
              fontSize: 15,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.74)",
              letterSpacing: "-0.005em",
            }}
          >
            Renew to get back into the dashboard, your progress, and the bounty program. We&rsquo;ve kept everything where you left it.
          </p>

          {/* Renew CTA - primary */}
          <a
            href={RENEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginTop: 4,
              padding: "14px 22px",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(238,242,247,0.96) 100%)",
              border: "1px solid rgba(255,255,255,0.40)",
              borderRadius: 12,
              color: "rgba(15,17,21,0.92)",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.02em",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              boxShadow:
                "0 8px 22px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.60) inset, 0 -1px 0 rgba(0,0,0,0.15) inset",
            }}
          >
            Renew on Whop
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>

          {/* Sign out - secondary, smaller */}
          <button
            type="button"
            onClick={() => void signOut()}
            style={{
              alignSelf: "center",
              marginTop: 6,
              padding: "8px 14px",
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.52)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Or sign out
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
