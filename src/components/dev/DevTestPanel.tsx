"use client";

import { useEffect, useState } from "react";

/**
 * Dev-only test panel — floating button bottom-right that opens a
 * panel of "fire this state" buttons. Lets the developer test every
 * visual moment (region transitions, streak celebration, banner
 * states, etc.) without touching the backend.
 *
 * Wiring: each button dispatches a window CustomEvent on the
 * `et:test:*` namespace. The relevant component listens for the
 * event and updates its visual state. No API calls, no DB writes.
 *
 * Listeners:
 *   et:test:transition   → MapMockup transitions to detail.target
 *   et:test:streak       → DashboardPage shows StreakCelebration with detail
 *   et:test:banner       → DiscountUrgencyBanner overrides its state
 *   et:test:banner-clear → clears any banner override
 */
export function DevTestPanel() {
  const [open, setOpen] = useState(false);
  const [streakValue, setStreakValue] = useState(7);
  const [daysOverride, setDaysOverride] = useState(5);
  const [bannerCode, setBannerCode] = useState("ECOM30-TEST42");

  function fire(name: string, detail?: unknown) {
    window.dispatchEvent(new CustomEvent(`et:test:${name}`, { detail }));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Dev test panel"
        aria-label="Open dev test panel"
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9000,
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "rgba(20, 22, 26, 0.85)",
          border: "1px solid rgba(255, 255, 255, 0.20)",
          color: "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          boxShadow: "0 8px 24px rgba(0,0,0,0.40)",
        }}
      >
        🛠
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9000,
        width: 280,
        maxHeight: "80vh",
        overflowY: "auto",
        padding: 14,
        borderRadius: 12,
        background: "rgba(15, 17, 21, 0.94)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.50)",
        color: "rgba(255, 255, 255, 0.92)",
        fontSize: 12,
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        letterSpacing: "-0.005em",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: "1px solid rgba(255, 255, 255, 0.10)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>Dev test panel</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255, 255, 255, 0.55)",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
            width: 20,
            height: 20,
          }}
        >
          ×
        </button>
      </header>

      <Section title="Map transitions">
        <div className="grid grid-cols-2" style={{ gap: 6 }}>
          {(["r1", "r2", "r3", "r4"] as const).map((r) => (
            <Btn key={r} onClick={() => fire("transition", r)}>
              → {r.toUpperCase()}
            </Btn>
          ))}
        </div>
        <Btn onClick={() => fire("transition", "overview")}>→ Overview</Btn>
      </Section>

      <Section title="Streak celebration">
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="number"
            min={1}
            max={365}
            value={streakValue}
            onChange={(e) => setStreakValue(parseInt(e.target.value, 10) || 1)}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              color: "rgba(255, 255, 255, 0.92)",
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
            }}
          />
          <Btn onClick={() => fire("streak", streakValue)}>Fire</Btn>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 3, 7, 14, 30].map((n) => (
            <Btn key={n} onClick={() => fire("streak", n)}>
              {n}d
            </Btn>
          ))}
        </div>
      </Section>

      <Section title="Discount banner state">
        <div style={{ display: "flex", gap: 6 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flex: 1,
              fontSize: 11,
              color: "rgba(255, 255, 255, 0.55)",
            }}
          >
            Days
            <input
              type="number"
              min={0}
              max={30}
              value={daysOverride}
              onChange={(e) =>
                setDaysOverride(parseInt(e.target.value, 10) || 0)
              }
              style={{
                width: "100%",
                padding: "4px 8px",
                borderRadius: 6,
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.16)",
                color: "rgba(255, 255, 255, 0.92)",
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
              }}
            />
          </label>
          <Btn
            onClick={() =>
              fire("banner", { state: "countdown", days: daysOverride })
            }
          >
            Set
          </Btn>
        </div>
        <Btn onClick={() => fire("banner", { state: "eligible" })}>
          Eligible
        </Btn>
        <Btn onClick={() => fire("banner", { state: "pending" })}>
          Pending
        </Btn>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={bannerCode}
            onChange={(e) => setBannerCode(e.target.value)}
            placeholder="ECOM30-..."
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              color: "rgba(255, 255, 255, 0.92)",
              fontSize: 11,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          />
          <Btn
            onClick={() =>
              fire("banner", { state: "approved", code: bannerCode })
            }
          >
            Approved
          </Btn>
        </div>
        <Btn onClick={() => fire("banner", { state: "rejected" })}>
          Rejected
        </Btn>
        <Btn onClick={() => fire("banner-clear")}>Clear override</Btn>
      </Section>

      <Section title="Discount approval celebration">
        <Btn onClick={() => fire("discount-approved", bannerCode)}>
          Fire with current code
        </Btn>
      </Section>

      <p
        style={{
          fontSize: 10,
          color: "rgba(255, 255, 255, 0.40)",
          marginTop: 12,
          letterSpacing: "-0.005em",
        }}
      >
        All overrides are client-side only. Reload to reset.
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "rgba(255, 255, 255, 0.40)",
          marginBottom: 6,
        }}
      >
        {title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        background: "rgba(255, 255, 255, 0.06)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        color: "rgba(255, 255, 255, 0.85)",
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "-0.005em",
        cursor: "pointer",
        transition: "all 120ms cubic-bezier(0.25, 0.1, 0.25, 1)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.28)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.16)";
      }}
    >
      {children}
    </button>
  );
}

/**
 * Helper to subscribe to a test event with proper TypeScript narrowing.
 * Caller pushes the right shape via the generic.
 */
export function useTestEvent<T = unknown>(
  name: string,
  handler: (detail: T) => void,
) {
  useEffect(() => {
    const wrapped = (e: Event) => {
      const ce = e as CustomEvent<T>;
      handler(ce.detail);
    };
    window.addEventListener(`et:test:${name}`, wrapped);
    return () => window.removeEventListener(`et:test:${name}`, wrapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}

/** Banner override shape — discount banner reads this when set. */
export type BannerOverride =
  | { state: "countdown"; days: number }
  | { state: "eligible" }
  | { state: "pending" }
  | { state: "approved"; code: string }
  | { state: "rejected" };
