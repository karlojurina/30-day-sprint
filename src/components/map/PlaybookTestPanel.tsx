"use client";

import { useState } from "react";

/**
 * /dashboard-mockup dev panel for the Playbook + R4 end-game visuals.
 *
 * Lets us exercise the locked / unlocked Playbook aura without flipping
 * bounty_access_claimed_at in the database. The page reads these
 * overrides and passes them into <MapMockup testOverrides={...} />.
 *
 * Collapsed by default as a small "Playbook test" pill in the
 * bottom-left (so it doesn't collide with SyncDebugPanel on the
 * right). Click to expand → three states for bountyAccessClaimedAt:
 *   - real  → fall through to StudentContext (the normal student view)
 *   - off   → force-locked, fog visible, click → toast
 *   - on    → force-unlocked, gold glow on hover, click → /playbook
 *
 * v50.3 — added with the Playbook aura work so Lovro can verify the
 * locked-fog → unlocked-glow transition + the hover treatment without
 * needing a real Ad Bounty webhook event.
 */
export type BountyAccessOverride = "real" | "off" | "on";

interface PlaybookTestPanelProps {
  bountyOverride: BountyAccessOverride;
  onBountyOverrideChange: (next: BountyAccessOverride) => void;
}

export function PlaybookTestPanel({
  bountyOverride,
  onBountyOverrideChange,
}: PlaybookTestPanelProps) {
  const [open, setOpen] = useState(false);

  const pillState =
    bountyOverride === "real"
      ? "real"
      : bountyOverride === "on"
        ? "unlocked"
        : "locked";
  const pillColor = {
    real: "#4DCEC4",
    unlocked: "#E6C07A",
    locked: "#9CA3AF",
  }[pillState];
  const pillLabel = {
    real: "Playbook test · real",
    unlocked: "Playbook test · unlocked",
    locked: "Playbook test · locked",
  }[pillState];

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        zIndex: 70,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
      }}
    >
      {open ? (
        <div
          style={{
            width: 320,
            background: "rgba(6,12,26,0.96)",
            border: "1px solid rgba(230,192,122,0.3)",
            borderRadius: 10,
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            color: "#E6DCC8",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid rgba(230,192,122,0.15)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: pillColor,
              }}
            >
              Playbook test · {pillState}
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close test panel"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(230,220,200,0.6)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: "12px 14px", fontSize: 12 }}>
            <div
              style={{
                color: "rgba(230,220,200,0.6)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              bounty_access_claimed_at
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SegmentRow
                label="Real student state"
                hint="reads from StudentContext"
                active={bountyOverride === "real"}
                onClick={() => onBountyOverrideChange("real")}
              />
              <SegmentRow
                label="Force locked (off)"
                hint="fog, hover does nothing, click → toast"
                active={bountyOverride === "off"}
                onClick={() => onBountyOverrideChange("off")}
              />
              <SegmentRow
                label="Force unlocked (on)"
                hint="gold aura, hover brightens, click → /playbook"
                active={bountyOverride === "on"}
                onClick={() => onBountyOverrideChange("on")}
              />
            </div>

            <div
              style={{
                height: 1,
                background: "rgba(230,192,122,0.12)",
                margin: "12px 0 10px",
              }}
            />

            <p
              style={{
                fontSize: 10,
                color: "rgba(230,220,200,0.5)",
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Open R4 to see the Playbook aura on the volcano. The
              override only affects the mockup surface - your real DB
              row isn&rsquo;t touched.
            </p>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(6,12,26,0.92)",
            border: `1px solid ${pillColor}`,
            color: pillColor,
            cursor: "pointer",
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontWeight: 600,
            fontFamily: "inherit",
            boxShadow: "0 10px 24px rgba(0,0,0,0.4)",
          }}
          aria-label="Open Playbook test panel"
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: pillColor,
              marginRight: 8,
              verticalAlign: -1,
              boxShadow: `0 0 6px ${pillColor}`,
            }}
          />
          {pillLabel}
        </button>
      )}
    </div>
  );
}

function SegmentRow({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 6,
        background: active ? "rgba(230,192,122,0.14)" : "rgba(6,12,26,0.4)",
        border: active
          ? "1px solid rgba(230,192,122,0.6)"
          : "1px solid rgba(230,220,200,0.12)",
        color: active ? "#F4E2B6" : "#E6DCC8",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span
        style={{
          fontSize: 10,
          color: active ? "rgba(244,226,182,0.7)" : "rgba(230,220,200,0.45)",
          letterSpacing: "0.04em",
        }}
      >
        {hint}
      </span>
    </button>
  );
}
