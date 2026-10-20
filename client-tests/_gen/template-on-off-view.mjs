"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function TemplateOnOff({ view, canEdit, busy, onToggle, }) {
    if (view.kind === "none") {
        return (_jsx("p", { style: {
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--color-text-secondary)",
            }, children: view.line }));
    }
    const waits = !view.on && view.turnOnWaits != null;
    const disabled = busy || waits;
    return (_jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsx("span", { style: {
                    fontSize: 13,
                    fontWeight: 600,
                    color: view.on ? "var(--color-text-primary)" : "var(--color-warning)",
                }, children: view.line }), canEdit && (_jsx("button", { type: "button", disabled: disabled, onClick: onToggle, style: {
                    minHeight: 44,
                    padding: "0 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: "var(--radius-pill)",
                    background: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                    opacity: disabled ? 0.4 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                }, children: view.on ? "Turn off" : "Turn on" })), canEdit && waits && (_jsx("span", { style: { fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }, children: view.turnOnWaits }))] }));
}
