/**
 * Admin UI primitives.
 *
 * Goal: a tight, opinionated set of components that every admin page
 * uses, so we stop writing 5-line inline-style blocks for every label
 * and card. Keeps the visual language consistent and the page files
 * focused on data + layout instead of pixels.
 *
 * Design rules embedded here:
 *   • One radius: 10
 *   • Spacing scale: 8 / 16 / 24 / 32 / 48
 *   • Type scale: 11 (eyebrow / meta) / 13 (body) / 20 (heading) / 32 (display)
 *   • Surfaces use the existing .surface-resting / .surface-elevated CSS
 *   • Pills use the existing .pill-tone-* CSS
 *   • Color is signal, not decoration — sage = primary, warm = warn, red = danger
 *
 * Anything that doesn't fit one of these primitives should be inlined
 * (it's probably a one-off and shouldn't pretend to be reusable).
 */

import Link from "next/link";
import React from "react";

/* ─── Type tokens (use these instead of inline fontSize numbers) ─── */

export const T = {
  /** 11px, uppercase tracked, tertiary — for section eyebrows. */
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-text-tertiary)",
  } as React.CSSProperties,
  /** 11px, tertiary — for byline meta under a heading. */
  meta: {
    fontSize: 11,
    color: "var(--color-text-tertiary)",
    fontVariantNumeric: "tabular-nums",
  } as React.CSSProperties,
  /** 13px, primary — default reading text. */
  body: {
    fontSize: 13,
    color: "var(--color-text-primary)",
    letterSpacing: "-0.005em",
  } as React.CSSProperties,
  /** 13px, secondary — descriptive text under a heading. */
  bodyDim: {
    fontSize: 13,
    color: "var(--color-text-secondary)",
    letterSpacing: "-0.005em",
  } as React.CSSProperties,
  /** 15px primary, used for card titles. */
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.011em",
    color: "var(--color-text-primary)",
  } as React.CSSProperties,
  /** 20px primary, used for section headings inside a page. */
  heading: {
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: "-0.018em",
    color: "var(--color-text-primary)",
  } as React.CSSProperties,
  /** 32px primary, used for the H1 at the top of a page. */
  display: {
    fontSize: 32,
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: 1.15,
    color: "var(--color-text-primary)",
  } as React.CSSProperties,
};

/* ─── Page scaffolding ─── */

/**
 * Outer wrapper for every admin page. Standard padding + max width
 * so pages don't each invent their own.
 */
export function AdminPage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-8 lg:px-12 pt-10 pb-16"
      style={{ maxWidth: 1180, margin: "0 auto" }}
    >
      {children}
    </div>
  );
}

/**
 * Page-level header. Title + optional description + optional right-side
 * actions slot (e.g. a Refresh button). The bottom margin matches the
 * spacing scale so sections below sit at the right vertical rhythm.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Tertiary metadata line under the description. E.g. "Updated
   *  18:11:13". Renders smaller + dimmer than `description` so the
   *  hierarchy stays title > description > meta. */
  meta?: React.ReactNode;
}) {
  return (
    <header
      className="flex items-start justify-between gap-4 flex-wrap"
      style={{ marginBottom: 32 }}
    >
      <div>
        <h1 style={T.display}>{title}</h1>
        {description && (
          <p style={{ ...T.bodyDim, marginTop: 4 }}>{description}</p>
        )}
        {meta && (
          <p
            style={{
              ...T.meta,
              marginTop: 6,
              color: "var(--color-text-tertiary)",
            }}
          >
            {meta}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap">{actions}</div>
      )}
    </header>
  );
}

/**
 * A vertical-rhythm section. Optional eyebrow label + count + right
 * action (e.g. "See all"). Sections stack with consistent margin and
 * never share a border with each other — spacing carries the structure.
 */
export function Section({
  eyebrow,
  count,
  action,
  children,
  style,
}: {
  eyebrow?: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section style={{ marginBottom: 32, ...style }}>
      {(eyebrow || count !== undefined || action) && (
        <div
          className="flex items-baseline justify-between"
          style={{ marginBottom: 12 }}
        >
          <div className="flex items-baseline gap-2">
            {eyebrow && <span style={T.eyebrow}>{eyebrow}</span>}
            {count !== undefined && (
              <span style={{ ...T.meta, fontWeight: 500 }}>{count}</span>
            )}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ─── Surfaces ─── */

/**
 * The card. Use for any clickable / hoverable surface. Has the
 * existing surface-resting shadow + 10px radius. `padding` defaults
 * to 16; pass 0 to lay out internal sub-sections (e.g. a list inside).
 * `onClick`/`href` get keyboard support for free.
 */
export function Card({
  children,
  padding = 16,
  onClick,
  href,
  className = "",
  style,
}: {
  children: React.ReactNode;
  padding?: number;
  onClick?: () => void;
  href?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const base: React.CSSProperties = {
    background: "var(--color-bg-card)",
    borderRadius: "var(--radius-card)",
    padding,
    cursor: onClick || href ? "pointer" : "default",
    textDecoration: "none",
    color: "inherit",
    display: "block",
    ...style,
  };
  if (href) {
    return (
      <Link
        href={href}
        className={`surface-resting transition-colors ${className}`}
        style={base}
      >
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`surface-resting transition-colors ${className}`}
        style={{ ...base, border: "none", textAlign: "left", width: "100%" }}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={`surface-resting ${className}`} style={base}>
      {children}
    </div>
  );
}

/* ─── Stat ─── */

/**
 * A single stat: tiny eyebrow + big numeral + optional sublabel. Used
 * in stat rows. For sparkline tiles, compose your own with this + a
 * chart child.
 */
export function Stat({
  label,
  value,
  sublabel,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: "default" | "accent" | "warn" | "danger";
}) {
  const valueColor =
    tone === "accent"
      ? "var(--color-accent-dark)"
      : tone === "warn"
        ? "var(--color-warning)"
        : tone === "danger"
          ? "var(--color-danger)"
          : "var(--color-text-primary)";
  return (
    <Card>
      <p style={T.eyebrow}>{label}</p>
      <p
        className="stat-value"
        style={{
          fontSize: 28,
          fontWeight: 600,
          color: valueColor,
          marginTop: 8,
          letterSpacing: "-0.024em",
          lineHeight: 1.0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
      {sublabel && (
        <p style={{ ...T.meta, marginTop: 6 }}>{sublabel}</p>
      )}
    </Card>
  );
}

/* ─── Pills ─── */

export type PillTone =
  | "success"
  | "warning"
  | "danger"
  | "accent"
  | "neutral";

/**
 * Status badge. Maps to the pill-tone-* CSS classes already in
 * globals.css so we stay on the system.
 */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: PillTone;
  children: React.ReactNode;
}) {
  return <span className={`pill-tone pill-tone-${tone}`}>{children}</span>;
}

/**
 * Pace pill — student progress relative to expected pace for their
 * day. Admin-only signal that lives next to the student's name on
 * /admin/students and on task cards.
 *
 *   label = "behind"  -> red
 *   label = "on_pace" -> neutral
 *   label = "ahead"   -> green
 *
 * Pass `compact` to render just the icon (no label) — useful inside
 * very dense rows like task cards.
 */
export function PacePill({
  label,
  compact = false,
}: {
  label: "behind" | "on_pace" | "ahead";
  compact?: boolean;
}) {
  const tone: PillTone =
    label === "behind"
      ? "danger"
      : label === "ahead"
        ? "success"
        : "neutral";
  const icon = label === "behind" ? "↓" : label === "ahead" ? "↑" : "→";
  const text =
    label === "behind"
      ? "Behind"
      : label === "ahead"
        ? "Ahead"
        : "On pace";
  return (
    <Pill tone={tone}>
      <span aria-hidden="true">{icon}</span>
      {!compact && <span>{text}</span>}
    </Pill>
  );
}

/* ─── Buttons ─── */

type ButtonVariant = "primary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md";

function buttonStyle(
  variant: ButtonVariant,
  size: ButtonSize,
  busy: boolean,
): React.CSSProperties {
  const pad = size === "sm" ? "5px 12px" : "8px 16px";
  const fs = size === "sm" ? 12 : 13;
  const base: React.CSSProperties = {
    padding: pad,
    fontSize: fs,
    fontWeight: 600,
    borderRadius: "var(--radius-chip)",
    border: "1px solid transparent",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1,
    letterSpacing: "-0.005em",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: "background 150ms var(--ease-default)",
  };
  if (variant === "primary") {
    return {
      ...base,
      background: "var(--color-accent-dark)",
      color: "#FFFFFF",
    };
  }
  if (variant === "danger") {
    return {
      ...base,
      background: "var(--color-danger)",
      color: "#FFFFFF",
    };
  }
  if (variant === "subtle") {
    return {
      ...base,
      background: "var(--color-bg-elevated)",
      color: "var(--color-text-primary)",
      border: "1px solid var(--color-border)",
    };
  }
  // ghost
  return {
    ...base,
    background: "transparent",
    color: "var(--color-text-secondary)",
    border: "1px solid var(--color-border)",
  };
}

export function Button({
  children,
  variant = "ghost",
  size = "sm",
  busy = false,
  onClick,
  href,
  type = "button",
  disabled,
  title,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  href?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}) {
  const style = buttonStyle(variant, size, busy);
  if (href) {
    return (
      <Link href={href} style={style} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      style={style}
      title={title}
    >
      {children}
    </button>
  );
}

/**
 * Small circular icon button. For kebab menus, close buttons, etc.
 */
export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: "var(--radius-chip)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-tertiary)",
        transition: "background 150ms var(--ease-default), color 150ms var(--ease-default)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(20,20,24,0.06)";
        e.currentTarget.style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--color-text-tertiary)";
      }}
    >
      {children}
    </button>
  );
}

/* ─── Avatar ─── */

export function Avatar({
  src,
  name,
  size = 28,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
}) {
  const initial = (name ?? "?")[0]?.toUpperCase() ?? "?";
  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        fontSize: size <= 28 ? 11 : 14,
        fontWeight: 600,
        background: src
          ? `url(${src}) center/cover`
          : "var(--color-accent-glow)",
        color: "var(--color-accent-dark)",
      }}
    >
      {src ? "" : initial}
    </div>
  );
}

/* ─── Tabs ─── */

/**
 * Pill-style tab segment control. Wide enough for 2–4 status filters.
 * Counts are optional but lean into the "what's waiting?" affordance.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex"
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-control)",
        padding: 3,
        gap: 2,
      }}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              letterSpacing: "-0.006em",
              borderRadius: "var(--radius-chip)",
              border: "none",
              cursor: "pointer",
              background: active ? "var(--color-bg-card)" : "transparent",
              color: active
                ? "var(--color-text-primary)"
                : "var(--color-text-secondary)",
              boxShadow: active
                ? "0 1px 2px rgba(20,20,24,0.06), 0 4px 8px rgba(20,20,24,0.04)"
                : "none",
              transition: "all 150ms var(--ease-default)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  color: active
                    ? "var(--color-text-tertiary)"
                    : "var(--color-text-tertiary)",
                  fontWeight: 500,
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Empty state ─── */

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--color-text-tertiary)",
      }}
    >
      {icon && (
        <div
          style={{
            fontSize: 28,
            marginBottom: 8,
            opacity: 0.5,
          }}
        >
          {icon}
        </div>
      )}
      <p style={{ ...T.body, color: "var(--color-text-secondary)" }}>{title}</p>
      {description && (
        <p style={{ ...T.meta, marginTop: 4 }}>{description}</p>
      )}
    </div>
  );
}

/* ─── Modal ─── */

/**
 * Centered modal with backdrop. Click backdrop to close. Children
 * fill the modal body — no opinionated header so the modal can be
 * used for very different content.
 */
export function Modal({
  open,
  onClose,
  maxWidth = 580,
  children,
}: {
  open: boolean;
  onClose: () => void;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,20,24,0.42)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface-elevated"
        style={{
          background: "var(--color-bg-card)",
          borderRadius: "var(--radius-sheet)",
          width: "100%",
          maxWidth,
          maxHeight: "85vh",
          overflow: "auto",
          padding: 24,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── Toast ─── */

export function Toast({ message }: { message: string }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        padding: "10px 14px",
        borderRadius: "var(--radius-card)",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
        fontSize: 13,
        boxShadow: "0 8px 24px rgba(20,20,24,0.18)",
        zIndex: 1000,
        maxWidth: 380,
      }}
    >
      {message}
    </div>
  );
}

/* ─── Restricted-page stub ─── */

/**
 * v75.3 - shown when a CSM-role member URL-hops onto a page that's
 * scoped to founders or admins. Renders the page chrome (so the nav
 * is still there) plus a polite "not for you" card. Server-side gates
 * remain the source of truth for the underlying data; this is just
 * the user-facing dead-end.
 */
export function RestrictedPage({
  title,
  reason,
}: {
  title: string;
  reason?: string;
}) {
  return (
    <AdminPage>
      <PageHeader
        title={title}
        description="This page isn't available for your role."
      />
      <Card padding={28}>
        <p style={T.bodyDim}>
          {reason ??
            "Ask a founder or admin if you need access — it's a quick role change."}
        </p>
      </Card>
    </AdminPage>
  );
}
