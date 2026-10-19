"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function TemplateOnOff({ view, canEdit, busy, onToggle, }) {
    if (view.kind === "none") {
        return (_jsx("p", { style: {
                marginTop: 14,
                fontSize: 13,
                color: "var(--color-text-secondary)",
            }, children: view.line }));
    }
    const waits = !view.on && view.turnOnWaits != null;
    const disabled = busy || waits;
    return (_jsxs("div", { className: "flex items-center gap-3 flex-wrap", style: { marginTop: 14 }, children: [_jsx("span", { style: {
                    fontSize: 13,
                    color: view.on ? "var(--color-text-secondary)" : "var(--color-warning)",
                }, children: view.line }), canEdit && (_jsx("button", { type: "button", disabled: disabled, onClick: onToggle, style: {
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 6,
                    background: "transparent",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-secondary)",
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                }, children: view.on ? "Turn off" : "Turn on" })), canEdit && waits && (_jsx("span", { style: { fontSize: 12, color: "var(--color-text-tertiary)" }, children: view.turnOnWaits }))] }));
}
