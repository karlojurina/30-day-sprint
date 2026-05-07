"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";

/**
 * Permanent banner under the TopBar that shows the discount state at
 * all times — replaces the previous auto-dismissing 5s urgency strip
 * AND the now-removed status text under the progress bar.
 *
 * Five visible states (everything else hides the banner):
 *   - countdown:  "12d 5h 23m 4s left to earn your 30% discount"
 *   - eligible:   "Ready to apply for your 30% discount"
 *   - pending:    "Application under review · usually within 24h"
 *   - approved:   "Your 30% code · ECOM30-XXX  [copy]"
 *   - rejected:   "Application not approved · DM the team in Discord"
 *
 * The countdown ticks once per second so the seconds change live.
 */
export function DiscountUrgencyBanner() {
  const { student } = useAuth();
  const { discountRequest, discountAllLessonsDone } = useStudent();

  // Tick once a second so the live countdown updates without forcing
  // the whole student context to re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [copied, setCopied] = useState(false);

  // Compute LIVE ms remaining from joined_at + window. Re-evaluated
  // every render (the tick above forces re-renders every second).
  const discountMsLeft = (() => {
    if (!student) return 0;
    const joined = new Date(student.joined_at).getTime();
    const deadline = joined + DISCOUNT_WINDOW_DAYS * 86_400_000;
    return deadline - Date.now();
  })();

  // Determine state
  let state: "countdown" | "eligible" | "pending" | "approved" | "rejected" | "hidden" =
    "hidden";

  if (discountRequest?.status === "approved") {
    state = "approved";
  } else if (discountRequest?.status === "pending") {
    state = "pending";
  } else if (discountRequest?.status === "rejected") {
    state = "rejected";
  } else if (discountAllLessonsDone) {
    state = "eligible";
  } else if (discountMsLeft > 0) {
    state = "countdown";
  } else {
    state = "hidden";
  }

  if (state === "hidden") return null;

  // Format remaining time as "Xd Yh Zm Ws" (drop leading zero units).
  function formatRemaining(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(totalSec / 86_400);
    const h = Math.floor((totalSec % 86_400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  }

  // Tone — drives accent + border + bg colors
  const daysLeft = Math.max(0, Math.ceil(discountMsLeft / 86_400_000));
  const tone =
    state === "rejected"
      ? "danger"
      : state === "approved"
        ? "success"
        : state === "countdown" && daysLeft <= 2
          ? "danger"
          : "neutral";

  const palette =
    tone === "danger"
      ? {
          bg: "rgba(180, 64, 60, 0.16)",
          border: "rgba(220, 96, 96, 0.40)",
          text: "rgba(255, 220, 220, 0.94)",
          accent: "#F08080",
        }
      : tone === "success"
        ? {
            bg: "rgba(255, 255, 255, 0.10)",
            border: "rgba(255, 255, 255, 0.28)",
            text: "rgba(255, 255, 255, 0.96)",
            accent: "#FFFFFF",
          }
        : {
            bg: "rgba(255, 255, 255, 0.06)",
            border: "rgba(255, 255, 255, 0.18)",
            text: "rgba(255, 247, 235, 0.90)",
            accent: "#F5F5F0",
          };

  function handleCopyCode() {
    if (state !== "approved" || !discountRequest?.promo_code) return;
    navigator.clipboard.writeText(discountRequest.promo_code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        top: 0,
        left: "50%",
        transform: "translate(-50%, 0)",
        zIndex: 25,
        marginTop: 12,
        padding: "10px 22px",
        borderRadius: 999,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        boxShadow:
          "0 8px 24px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.04) inset",
        color: palette.text,
        userSelect: "none",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <BannerIcon state={state} accent={palette.accent} />
      <BannerText
        state={state}
        accent={palette.accent}
        remaining={formatRemaining(discountMsLeft)}
        code={discountRequest?.promo_code}
        copied={copied}
        onCopy={handleCopyCode}
      />
    </div>
  );
}

function BannerIcon({
  state,
  accent,
}: {
  state: "countdown" | "eligible" | "pending" | "approved" | "rejected";
  accent: string;
}) {
  if (state === "approved") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={accent}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (state === "rejected") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={accent}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  // countdown / eligible / pending all show the clock
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={accent}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}

function BannerText({
  state,
  accent,
  remaining,
  code,
  copied,
  onCopy,
}: {
  state: "countdown" | "eligible" | "pending" | "approved" | "rejected";
  accent: string;
  remaining: string;
  code: string | null | undefined;
  copied: boolean;
  onCopy: () => void;
}) {
  const baseStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: "-0.011em",
  };
  const accentStyle: React.CSSProperties = {
    color: accent,
    fontWeight: 700,
  };

  if (state === "countdown") {
    return (
      <span style={baseStyle}>
        <span className="tabular-nums" style={accentStyle}>
          {remaining}
        </span>
        {" "}left to earn your{" "}
        <span style={accentStyle}>30% discount</span>
      </span>
    );
  }
  if (state === "eligible") {
    return (
      <span style={baseStyle}>
        <span style={accentStyle}>Ready to apply</span> for your 30% discount
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span style={baseStyle}>
        <span style={accentStyle}>Application under review</span>
        {" "}· usually within 24h
      </span>
    );
  }
  if (state === "rejected") {
    return (
      <span style={baseStyle}>
        Application not approved · DM the team in Discord
      </span>
    );
  }
  // approved
  return (
    <span style={baseStyle} className="flex items-center" >
      Your 30% code:{" "}
      <span className="tabular-nums" style={{ ...accentStyle, marginLeft: 6 }}>
        {code ?? "—"}
      </span>
      {code && (
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy code"
          style={{
            marginLeft: 8,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            color: accent,
            background: "rgba(255, 255, 255, 0.10)",
            border: "1px solid rgba(255, 255, 255, 0.20)",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </span>
  );
}
