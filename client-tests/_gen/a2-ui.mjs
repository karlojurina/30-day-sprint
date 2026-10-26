import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const Link = (props) => props.children;
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
    },
    /** 11px, tertiary — for byline meta under a heading. */
    meta: {
        fontSize: 11,
        color: "var(--color-text-tertiary)",
        fontVariantNumeric: "tabular-nums",
    },
    /** 13px, primary — default reading text. */
    body: {
        fontSize: 13,
        color: "var(--color-text-primary)",
        letterSpacing: "-0.005em",
    },
    /** 13px, secondary — descriptive text under a heading. */
    bodyDim: {
        fontSize: 13,
        color: "var(--color-text-secondary)",
        letterSpacing: "-0.005em",
    },
    /** 15px primary, used for card titles. */
    cardTitle: {
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: "-0.011em",
        color: "var(--color-text-primary)",
    },
    /** 20px primary, used for section headings inside a page. */
    heading: {
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: "-0.018em",
        color: "var(--color-text-primary)",
    },
    /** 32px primary, used for the H1 at the top of a page. */
    display: {
        fontSize: 32,
        fontWeight: 600,
        letterSpacing: "-0.025em",
        lineHeight: 1.15,
        color: "var(--color-text-primary)",
    },
};
/* ─── Page scaffolding ─── */
/**
 * Outer wrapper for every admin page. Standard padding + max width
 * so pages don't each invent their own.
 */
export function AdminPage({ children }) {
    return (_jsx("div", { className: "px-8 lg:px-12 pt-10 pb-16", style: { maxWidth: 1180, margin: "0 auto" }, children: children }));
}
/**
 * Page-level header. Title + optional description + optional right-side
 * actions slot (e.g. a Refresh button). The bottom margin matches the
 * spacing scale so sections below sit at the right vertical rhythm.
 */
export function PageHeader({ title, description, actions, meta, }) {
    return (_jsxs("header", { className: "flex items-start justify-between gap-4 flex-wrap", style: { marginBottom: 32 }, children: [_jsxs("div", { children: [_jsx("h1", { style: T.display, children: title }), description && (_jsx("p", { style: { ...T.bodyDim, marginTop: 4 }, children: description })), meta && (_jsx("p", { style: {
                            ...T.meta,
                            marginTop: 6,
                            color: "var(--color-text-tertiary)",
                        }, children: meta }))] }), actions && (_jsx("div", { className: "flex items-center gap-2 flex-wrap", children: actions }))] }));
}
/**
 * A vertical-rhythm section. Optional eyebrow label + count + right
 * action (e.g. "See all"). Sections stack with consistent margin and
 * never share a border with each other — spacing carries the structure.
 */
export function Section({ eyebrow, count, action, children, style, }) {
    return (_jsxs("section", { style: { marginBottom: 32, ...style }, children: [(eyebrow || count !== undefined || action) && (_jsxs("div", { className: "flex items-baseline justify-between", style: { marginBottom: 12 }, children: [_jsxs("div", { className: "flex items-baseline gap-2", children: [eyebrow && _jsx("span", { style: T.eyebrow, children: eyebrow }), count !== undefined && (_jsx("span", { style: { ...T.meta, fontWeight: 500 }, children: count }))] }), action && _jsx("div", { children: action })] })), children] }));
}
/* ─── Surfaces ─── */
/**
 * The card. Use for any clickable / hoverable surface. Has the
 * existing surface-resting shadow + 10px radius. `padding` defaults
 * to 16; pass 0 to lay out internal sub-sections (e.g. a list inside).
 * `onClick`/`href` get keyboard support for free.
 */
export function Card({ children, padding = 16, onClick, href, className = "", style, }) {
    const base = {
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
        return (_jsx(Link, { href: href, className: `surface-resting transition-colors ${className}`, style: base, children: children }));
    }
    if (onClick) {
        return (_jsx("button", { type: "button", onClick: onClick, className: `surface-resting transition-colors ${className}`, style: { ...base, border: "none", textAlign: "left", width: "100%" }, children: children }));
    }
    return (_jsx("div", { className: `surface-resting ${className}`, style: base, children: children }));
}
/* ─── Stat ─── */
/**
 * A single stat: tiny eyebrow + big numeral + optional sublabel. Used
 * in stat rows. For sparkline tiles, compose your own with this + a
 * chart child.
 */
export function Stat({ label, value, sublabel, tone = "default", }) {
    const valueColor = tone === "accent"
        ? "var(--color-accent-dark)"
        : tone === "warn"
            ? "var(--color-warning)"
            : tone === "danger"
                ? "var(--color-danger)"
                : "var(--color-text-primary)";
    return (_jsxs(Card, { children: [_jsx("p", { style: T.eyebrow, children: label }), _jsx("p", { className: "stat-value", style: {
                    fontSize: 28,
                    fontWeight: 600,
                    color: valueColor,
                    marginTop: 8,
                    letterSpacing: "-0.024em",
                    lineHeight: 1.0,
                    fontVariantNumeric: "tabular-nums",
                }, children: value }), sublabel && (_jsx("p", { style: { ...T.meta, marginTop: 6 }, children: sublabel }))] }));
}
/**
 * Status badge. Maps to the pill-tone-* CSS classes already in
 * globals.css so we stay on the system.
 */
export function Pill({ tone = "neutral", children, }) {
    return _jsx("span", { className: `pill-tone pill-tone-${tone}`, children: children });
}
function buttonStyle(variant, size, busy, disabled = false) {
    const pad = size === "sm" ? "5px 12px" : "8px 16px";
    const fs = size === "sm" ? 12 : 13;
    const base = {
        padding: pad,
        fontSize: fs,
        fontWeight: 600,
        borderRadius: "var(--radius-chip)",
        border: "1px solid transparent",
        cursor: busy ? "wait" : disabled ? "not-allowed" : "pointer",
        opacity: busy ? 0.6 : disabled ? 0.4 : 1,
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
            color: "var(--admin-danger-label, #FFFFFF)",
            borderRadius: "var(--admin-button-radius, var(--radius-chip))",
            minHeight: "var(--admin-button-min-height, auto)",
            justifyContent: "center",
        };
    }
    if (variant === "subtle") {
        return {
            ...base,
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--admin-button-radius, var(--radius-chip))",
            minHeight: "var(--admin-button-min-height, auto)",
        };
    }
    if (variant === "ink") {
        // The kit's tap target (44px) and button radius (12px).
        return {
            ...base,
            background: "#F7F6F3",
            color: "#18181A",
            borderRadius: "var(--radius-control)",
            minHeight: 44,
            justifyContent: "center",
        };
    }
    if (variant === "raised") {
        return {
            ...base,
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-pill)",
            minHeight: 44,
            justifyContent: "center",
        };
    }
    // ghost
    return {
        ...base,
        background: "transparent",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--admin-button-radius, var(--radius-chip))",
        minHeight: "var(--admin-button-min-height, auto)",
    };
}
export function Button({ children, variant = "ghost", size = "sm", busy = false, onClick, href, type = "button", disabled, title, expanded, controls, unavailable, }) {
    const off = Boolean(unavailable);
    const style = buttonStyle(variant, size, busy, disabled || off);
    if (href) {
        return (_jsx(Link, { href: href, style: style, title: title, children: children }));
    }
    return (_jsx("button", { type: type, onClick: off ? undefined : onClick, disabled: busy || disabled, "aria-disabled": off || undefined, style: style, title: unavailable ?? title, "aria-expanded": expanded, "aria-controls": controls, children: children }));
}
/* ─── Tabs ─── */
/**
 * Pill-style tab segment control. Wide enough for 2–4 status filters.
 * Counts are optional but lean into the "what's waiting?" affordance.
 */
export function Tabs({ tabs, value, onChange, }) {
    return (_jsx("div", { role: "tablist", className: "inline-flex", style: {
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-control)",
            padding: 3,
            gap: 2,
        }, children: tabs.map((t) => {
            const active = t.value === value;
            return (_jsxs("button", { role: "tab", "aria-selected": active, onClick: () => onChange(t.value), style: {
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
                }, children: [t.label, t.count !== undefined && (_jsx("span", { style: {
                            marginLeft: 6,
                            fontSize: 11,
                            color: active
                                ? "var(--color-text-tertiary)"
                                : "var(--color-text-tertiary)",
                            fontWeight: 500,
                        }, children: t.count }))] }, t.value));
        }) }));
}
/* ─── Empty state ─── */
export function EmptyState({ icon, title, description, }) {
    return (_jsxs("div", { style: {
            padding: "48px 24px",
            textAlign: "center",
            color: "var(--color-text-tertiary)",
        }, children: [icon && (_jsx("div", { style: {
                    fontSize: 28,
                    marginBottom: 8,
                    opacity: 0.5,
                }, children: icon })), _jsx("p", { style: { ...T.body, color: "var(--color-text-secondary)" }, children: title }), description && (_jsx("p", { style: { ...T.meta, marginTop: 4 }, children: description }))] }));
}
/* ─── Modal ─── */
/**
 * Centered modal with backdrop. Click backdrop to close. Children
 * fill the modal body — no opinionated header so the modal can be
 * used for very different content.
 */
export function Modal({ open, onClose, maxWidth = 580, children, }) {
    if (!open)
        return null;
    return (_jsx("div", { role: "dialog", "aria-modal": "true", style: {
            position: "fixed",
            inset: 0,
            background: "rgba(20,20,24,0.42)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 100,
        }, onClick: onClose, children: _jsx("div", { onClick: (e) => e.stopPropagation(), className: "surface-elevated", style: {
                background: "var(--color-bg-card)",
                borderRadius: "var(--radius-sheet)",
                width: "100%",
                maxWidth,
                maxHeight: "85vh",
                overflow: "auto",
                padding: 24,
            }, children: children }) }));
}
/* ─── Toast ─── */
export function Toast({ message }) {
    return (_jsx("div", { role: "status", style: {
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
        }, children: message }));
}
/* ─── Restricted-page stub ─── */
/**
 * v75.3 - shown when a CSM-role member URL-hops onto a page that's
 * scoped to founders or admins. Renders the page chrome (so the nav
 * is still there) plus a polite "not for you" card. Server-side gates
 * remain the source of truth for the underlying data; this is just
 * the user-facing dead-end.
 */
export function RestrictedPage({ title, reason, }) {
    return (_jsxs(AdminPage, { children: [_jsx(PageHeader, { title: title, description: "This page isn't available for your role." }), _jsx(Card, { padding: 28, children: _jsx("p", { style: T.bodyDim, children: reason ??
                        "Ask a founder or admin if you need access — it's a quick role change." }) })] }));
}
