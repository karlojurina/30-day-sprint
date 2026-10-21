"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Pill, T } from "./ar-ui.mjs";
import { ReadFailure } from "./ar-review-parts.mjs";
/**
 * Pieces the rebuilt list pages share (admin rebuild PRD): the 30% page
 * (thirty/ThirtyView.tsx) and every page admin rebuild 2 rebuilt. They read
 * the dark look's tokens (admin-tokens.module.css) and sit inside it. The
 * pieces only Today and the old 30% rows used (how to reach a student on
 * Discord, the last contact, the time left, Whop not pulled) went with them
 * in the review's fix round.
 *
 *   ListPage          the page's frame: ui.tsx's AdminPage, with the kit's
 *                     16px side gutter on a phone
 *   ListHeader        the title with Refresh beside it, the description, and
 *                     "Updated 09:30" at 12px
 *   MembershipPill    the membership status, in words
 *   SkeletonRows      what a list shows while it loads (skeletons, not spinners)
 *   LoadError         what a list shows when it could not load, with Retry
 *   NoticeStack       what a row's button did, or what went wrong, in a fixed
 *                     place at the bottom of the window, where it is seen
 *                     wherever the click was
 *
 * Admin rebuild 2, the render review's fix round:
 *   FailedMeta        the header's meta line when the page's read failed
 *   PILL_ROW          a row of pills (tabs, filters, ranges) that scrolls on
 *                     one line on a phone instead of wrapping
 *   RowSplit          a list row's words on the left and its actions on the
 *                     right from 768px wide, the actions under the words below
 *
 * Every tap target here is at least 44px tall (the kit's touch target).
 */
/** The kit's touch target. */
export const TAP = 44;
/**
 * A row of pills: the tabs of Tasks, the filters and sorts of All students,
 * the ranges of the insights. Wide, it wraps. Under 640px it stays on one line
 * and scrolls sideways inside itself, out to the window's edges, as the 30%
 * page's tabs do: on a phone the rows wrapped onto a second and third line.
 * The 4px above and below keep a pill's focus ring inside the scroll box.
 * Spread it with the row's own gap in `style`.
 */
export const PILL_ROW = "flex flex-wrap max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:-mx-4 max-sm:px-4 max-sm:-my-1 max-sm:py-1 max-sm:[scrollbar-width:none]";
/**
 * The header's meta line once the page's read has failed: a warning dot and
 * the words, where "Loading" stood. The error itself, with Retry, is under
 * the header.
 */
export function FailedMeta({ text = "Couldn't load" }) {
    return (_jsxs("span", { "data-meta-failed": "", style: { display: "inline-flex", alignItems: "center", gap: 8, color: "var(--color-text-primary)" }, children: [_jsx("span", { "aria-hidden": "true", style: { flex: "none", width: 8, height: 8, borderRadius: 999, background: "var(--color-warning)" } }), text] }));
}
/**
 * A list row in two parts: what the row says on the left, its actions on the
 * right from 768px wide (top-aligned with the row's first line), and under
 * the words on a phone. Left under the words on a wide screen, the actions
 * left the right half of the card empty. What opens under a row (a confirm,
 * a reason) goes after this, across the whole row.
 */
export function RowSplit({ main, actions }) {
    return (_jsxs("div", { "data-row-split": "", className: "grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-start", style: { gap: "10px 24px" }, children: [_jsx("div", { style: { minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }, children: main }), actions ? (_jsx("div", { "data-row-actions": "", className: "flex flex-wrap items-center md:justify-end", style: { gap: 8 }, children: actions })) : null] }));
}
/**
 * A pill that is pressed or not: the 30% page's tabs. Raised surface and
 * hairline; pressed in Airy Blue.
 */
export function pressPill(pressed) {
    return {
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: TAP,
        padding: "0 14px",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${pressed ? "var(--color-accent-dark)" : "var(--color-border)"}`,
        background: pressed ? "var(--color-accent-glow)" : "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        fontSize: 13,
        fontWeight: pressed ? 600 : 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
    };
}
/**
 * The page's frame: AdminPage's width and rhythm (ui.tsx), with a 16px side
 * gutter on a phone instead of 32px, so a row at 390px wide keeps room for
 * its words. `wide`: the window's whole width with the same side margins,
 * where the 1084px column would squeeze the page (the Student journey's six
 * columns, the owner's review of 2026-10-21).
 */
export function ListPage({ children, wide = false }) {
    return (
    // pb-28: room under the last row for the notices fixed at the bottom of the window.
    _jsx("div", { "data-list-page": wide ? "wide" : "", className: "px-4 sm:px-8 lg:px-12 pt-4 sm:pt-10 pb-28", style: { maxWidth: wide ? "none" : 1180, margin: "0 auto" }, children: children }));
}
/**
 * The page's header. The title and its one action (Refresh) share a line on
 * every width, so on a phone the action does not take a line of its own; the
 * description and the meta line ("Updated 09:30", 12px, the kit's floor for
 * text that is not an eyebrow) follow.
 *
 * The title's line is 44px tall at least, with or without an action, so the
 * header keeps its height from page to page and from loading to loaded.
 * Several actions (`actions`, Templates' Refresh and New template) share the
 * title's line from 480px wide; under that they go under the description,
 * where they have the width (admin rebuild 2, the review's fix round).
 */
export function ListHeader({ title, description, meta, action, actions, }) {
    const many = (actions?.length ?? 0) > 1;
    const act = actions && actions.length > 0 ? actions : action;
    return (_jsxs("header", { className: "mb-4 sm:mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-center", style: { columnGap: 12 }, children: [_jsx("h1", { className: "col-start-1 row-start-1 flex items-center", style: { ...T.display, minWidth: 0, minHeight: TAP }, children: title }), act && (_jsx("div", { "data-header-actions": many ? "many" : "one", className: many
                    ? "col-start-2 row-start-1 flex flex-wrap items-center justify-end max-[479px]:col-span-2 max-[479px]:col-start-1 max-[479px]:row-start-auto max-[479px]:order-last max-[479px]:justify-start max-[479px]:mt-3"
                    : "col-start-2 row-start-1 flex items-center", style: { gap: 8 }, children: act })), _jsx("p", { className: "col-span-2", style: { ...T.bodyDim, marginTop: 4, lineHeight: 1.5 }, children: description }), meta && (_jsx("p", { className: "col-span-2", style: { marginTop: 4, fontSize: 12, color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums" }, children: meta }))] }));
}
/** The first word of a team member's name: "Messaged by Robin". */
export function firstName(name) {
    const first = (name ?? "").trim().split(/\s+/)[0];
    return first ? first : null;
}
const MEMBERSHIP = {
    active: { tone: "success", text: "Active" },
    past_due: { tone: "warning", text: "Payment failed" },
    canceled: { tone: "danger", text: "Canceled" },
    expired: { tone: "neutral", text: "Expired" },
};
/** The membership status in words (membership_status), never colour alone. */
export function MembershipPill({ status }) {
    const m = MEMBERSHIP[status] ?? { tone: "neutral", text: status || "No membership" };
    return _jsx(Pill, { tone: m.tone, children: m.text });
}
/** Grey bars in the shape of the rows, while a list loads. */
export function SkeletonRows({ rows = 4, label }) {
    return (_jsxs(Card, { padding: 0, children: [_jsx("p", { role: "status", className: "sr-only", children: label }), _jsx("div", { "aria-hidden": "true", children: Array.from({ length: rows }, (_, i) => (_jsxs("div", { className: "list-row", style: { flexDirection: "column", alignItems: "stretch", gap: 10, padding: 16 }, children: [_jsx(SkeletonBar, { width: "38%", height: 14 }), _jsx(SkeletonBar, { width: "72%" }), _jsx(SkeletonBar, { width: "54%" })] }, i))) })] }));
}
function SkeletonBar({ width, height = 10 }) {
    return (_jsx("div", { className: "animate-pulse", style: { width, height, borderRadius: 6, background: "var(--color-fill-secondary)" } }));
}
/**
 * A list that could not load: what happened, in a sentence, and Retry. The
 * reason is said in plain words (read-failure.ts); the database's own text
 * stays behind a closed Details (review-parts.tsx).
 */
export function LoadError({ title, detail, onRetry, busy, }) {
    return (_jsx(Card, { padding: 20, children: _jsxs("div", { role: "alert", style: { display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }, children: [_jsx("p", { style: { ...T.body, fontSize: 15, fontWeight: 600 }, children: title }), detail && _jsx(ReadFailure, { raw: detail, style: { alignSelf: "stretch" } }), _jsx(Button, { variant: "raised", size: "md", busy: busy, onClick: onRetry, children: "Retry" })] }) }));
}
/** A button that copies `text` and says so for a moment. */
export function CopyButton({ text, label }) {
    const [copied, setCopied] = useState(null);
    const timer = useRef(null);
    useEffect(() => () => {
        if (timer.current)
            clearTimeout(timer.current);
    }, []);
    return (_jsx(Button, { variant: "raised", size: "md", onClick: async () => {
            let ok = false;
            try {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
            catch {
                ok = false;
            }
            setCopied(ok ? "yes" : "failed");
            if (timer.current)
                clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(null), 1500);
        }, children: copied === "yes" ? "Copied" : copied === "failed" ? "Couldn't copy" : label }));
}
/** How long a success notice stays: time to press its Undo. */
export const NOTICE_SECONDS = 15;
const NOTICE_DOT = {
    success: "var(--color-success)",
    danger: "var(--color-danger)",
    warning: "var(--color-warning)",
};
/**
 * What a row's button did, or what went wrong, fixed at the bottom of the
 * window (the Toast pattern of ui.tsx). A click low on a long list sees its
 * answer where it is: a notice at the top of the page would be out of view,
 * and the row it was about may be gone after the list is read again.
 */
export function NoticeStack({ notices, onClose, onAction, }) {
    if (notices.length === 0)
        return null;
    return (_jsx("div", { style: {
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            // The strip between the cards lets clicks through to the page.
            pointerEvents: "none",
        }, children: notices.map((n) => (_jsx(NoticeCard, { notice: n, onClose: onClose, onAction: onAction }, n.id))) }));
}
function NoticeCard({ notice, onClose, onAction, }) {
    const close = useRef(onClose);
    useEffect(() => {
        close.current = onClose;
    });
    const busy = notice.action?.busy === true;
    useEffect(() => {
        if (notice.tone !== "success" || busy)
            return;
        const t = setTimeout(() => close.current(notice.id), NOTICE_SECONDS * 1000);
        return () => clearTimeout(t);
    }, [notice.id, notice.tone, busy]);
    return (_jsxs("div", { role: notice.tone === "success" ? "status" : "alert", style: {
            pointerEvents: "auto",
            width: "100%",
            maxWidth: 600,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "8px 12px",
            padding: "10px 10px 10px 14px",
            borderRadius: "var(--radius-card)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-strong)",
        }, children: [_jsxs("p", { style: { display: "flex", gap: 10, alignItems: "flex-start", flex: "1 1 260px", minWidth: 0 }, children: [_jsx("span", { "aria-hidden": "true", style: { flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: NOTICE_DOT[notice.tone] } }), _jsx("span", { style: { ...T.body, lineHeight: 1.5, overflowWrap: "anywhere" }, children: notice.text })] }), _jsxs("div", { className: "flex flex-wrap items-center", style: { gap: 8, marginLeft: "auto" }, children: [notice.copy && _jsx(CopyButton, { text: notice.copy.text, label: notice.copy.label }), notice.action && onAction && (_jsx(Button, { variant: "raised", size: "md", busy: notice.action.busy, onClick: () => onAction(notice.id), children: notice.action.label })), _jsx(Button, { variant: "ghost", size: "md", onClick: () => onClose(notice.id), children: "Dismiss" })] })] }));
}
/** The one line a list shows while what it shows may be out of date (a read after a change failed). */
export const STALE_TEXT = "Couldn't refresh the list, so it may be out of date. Press Refresh.";
