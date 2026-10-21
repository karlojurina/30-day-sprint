"use client";

import { T } from "@/components/admin/ui";
import { TAP } from "@/components/admin/list-parts";

/**
 * Form pieces the Templates and Team pages share (admin rebuild 2, WI-8 and
 * WI-9), in the brand kit's dark look. In this lane's own folder so the
 * shared list-parts.tsx and ui.tsx stay as milestone 1 left them.
 *
 * Every field is 44px tall at least with 16px text: a phone's browser zooms
 * the page into a field with smaller text. With a mouse on a window 640px
 * wide or more the text is 14px (--admin-field-size, admin-tokens.module.css;
 * the review's fix round: 16px looked oversized on a desktop).
 */

export const INPUT: React.CSSProperties = {
  width: "100%",
  minHeight: TAP,
  padding: "0 12px",
  fontSize: "var(--admin-field-size, 16px)",
  fontFamily: "inherit",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
};

export const TEXTAREA: React.CSSProperties = {
  ...INPUT,
  padding: "10px 12px",
  lineHeight: 1.55,
  resize: "vertical",
};

/** A labelled field: the eyebrow label, the control, and an optional line under it. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={htmlFor} style={{ ...T.eyebrow, color: "var(--color-text-secondary)" }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}

/** A coloured dot beside words: status is never colour alone. */
export function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: color }}
    />
  );
}

/** A lasting problem the page shows until it is fixed: an orange dot and the sentence. */
export function WarningLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 14px",
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <Dot color="var(--color-warning)" />
      <p style={{ ...T.body, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

/** A section heading inside a card. */
export function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 style={{ ...T.eyebrow, color: "var(--color-text-secondary)" }}>{children}</h3>;
}
