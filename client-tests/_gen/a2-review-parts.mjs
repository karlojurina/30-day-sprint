"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const Link = (props) => props.children;
import { T } from "./a2-ui.mjs";
import { hasDetails, plainReadError, plainReadErrors } from "./read-failure.ts";
/**
 * Pieces of admin rebuild 2's review fix round, in the dark look of
 * admin-tokens.module.css. In their own file (the round's lane), so the
 * shared list-parts.tsx and ui.tsx only import them.
 *
 *   ErrorDetails   the database's own words behind a small, closed "Details"
 *   ReadFailure    a failed read in plain words (read-failure.ts), then
 *                  ErrorDetails with the raw text when it says more
 *   ProblemNotice  a read that failed above a list that still shows: the
 *                  page's sentence, why in plain words, and Details
 *   FailureList    several failed reads: each plain sentence once, then one
 *                  Details naming every read with its raw text
 *   TextLink       a link to another page as Airy Blue words in a header
 *                  ("Outreach insights", "Queue"), 44px tall
 *
 * The summary is 44px tall (the kit's touch target) in 12px words, with the
 * browser's triangle, so it reads as something to press.
 */
/** The browser's own disclosure triangle (a list item), 44px tall with its padding, as the student page's other folds. */
const SUMMARY = {
    display: "list-item",
    padding: "12px 0",
    lineHeight: "20px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    cursor: "pointer",
};
const RAW = {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "var(--radius-chip)",
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border)",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--color-text-secondary)",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
};
/** The raw text of one or more failed reads, closed until pressed. */
export function ErrorDetails({ lines }) {
    if (lines.length === 0)
        return null;
    return (_jsxs("details", { "data-error-details": "", children: [_jsx("summary", { style: SUMMARY, children: "Details" }), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: lines.map((l) => (_jsx("p", { style: RAW, children: l }, l))) })] }));
}
/** One failed read: what it means, and the database's words behind Details when they say more. */
export function ReadFailure({ raw, lead, style, }) {
    const plain = plainReadError(raw);
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 2, ...style }, children: [_jsxs("p", { style: { ...T.body, lineHeight: 1.5 }, children: [lead ? `${lead} ` : "", _jsx("span", { style: lead ? { color: "var(--color-text-secondary)" } : undefined, children: plain })] }), hasDetails(raw) && _jsx(ErrorDetails, { lines: [String(raw).trim()] })] }));
}
/**
 * A read that failed, above a list that still shows (a list read again that
 * failed, a column that could not load): the page's sentence, why in plain
 * words, and the raw text behind Details. A status, not an alert: it stays
 * while the page is open. The dark look of people-parts.tsx's Warning.
 */
export function ProblemNotice({ text, raw }) {
    return (_jsxs("div", { role: "status", "data-problem": "", style: {
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            marginBottom: 12,
            padding: "10px 14px",
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
        }, children: [_jsx("span", { "aria-hidden": "true", style: { flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: "var(--color-warning)" } }), _jsxs("div", { style: { minWidth: 0, flex: "1 1 auto" }, children: [_jsxs("p", { style: { ...T.body, lineHeight: 1.5 }, children: [text, raw ? _jsxs("span", { style: { color: "var(--color-text-secondary)" }, children: [" ", plainReadError(raw)] }) : null] }), hasDetails(raw) && _jsx(ErrorDetails, { lines: [String(raw).trim()] })] })] }));
}
/** Several failed reads: each plain sentence once, and one Details with every read and its raw text. */
export function FailureList({ failures }) {
    const plain = plainReadErrors(failures.map((f) => f.error));
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [plain.map((p) => (_jsx("p", { style: { ...T.bodyDim, lineHeight: 1.5 }, children: p }, p))), _jsx(ErrorDetails, { lines: failures.map((f) => `${f.read}: ${f.error}`) })] }));
}
/** A link that reads as words in Airy Blue, 44px tall: the header's way to another page (the Dashboard's "Open Insights"). */
export function TextLink({ href, children }) {
    return (_jsx(Link, { href: href, style: {
            minHeight: 44,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 4px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-accent-dark)",
            textDecoration: "none",
            whiteSpace: "nowrap",
        }, children: children }));
}
