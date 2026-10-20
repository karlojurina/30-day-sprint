"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useId, useState } from "react";
import { Button, Card, Pill, T } from "./a2-ui.mjs";
import { LINK_PLACEHOLDER, masterTurnOnText, messagesUsing, settingsWarnings, switchViews, } from "./templates-data.ts";
import { Field, INPUT, SubHeading, WarningLine } from "./a2-form-parts.mjs";
const LINK_FIELDS = [
    { key: "program_login_link", label: "Program link", placeholder: "https://sprint.ecomuniversity.com/login" },
    { key: "discord_invite_link", label: "Discord invite link", placeholder: "https://discord.gg/your-invite" },
];
export function MessageSettings({ settings, templates, live, canEdit, onSave, }) {
    return (_jsx(Card, { padding: 20, style: { marginBottom: 24 }, children: _jsxs("section", { "aria-labelledby": "message-settings-title", style: { display: "flex", flexDirection: "column", gap: 16 }, children: [_jsxs("div", { children: [_jsx("h2", { id: "message-settings-title", style: T.cardTitle, children: "Message settings" }), _jsxs("p", { style: { ...T.bodyDim, marginTop: 4, lineHeight: 1.5 }, children: ["The links the messages fill in, and the automated Discord posts.", " ", canEdit ? "Founders and admins can change them." : "Only a founder or an admin can change them."] })] }), !settings.ok ? (_jsxs("p", { role: "alert", style: { ...T.body, lineHeight: 1.5 }, children: ["Couldn't load the message settings: ", settings.error, ". Press Refresh to try again."] })) : (_jsx(SettingsBody, { settings: settings, templates: templates, live: live, canEdit: canEdit, onSave: onSave }))] }) }));
}
function SettingsBody({ settings, templates, live, canEdit, onSave, }) {
    const values = settings.values;
    const warnings = settingsWarnings(values, templates, live);
    const { master, others } = switchViews(values);
    return (_jsxs(_Fragment, { children: [warnings.length > 0 && (_jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: warnings.map((w) => (_jsx(WarningLine, { children: w.text }, w.key))) })), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 14 }, children: [_jsx(SubHeading, { children: "Links" }), LINK_FIELDS.map((f) => (_jsx(LinkField
                    // A save, or a fresh read, changes the saved value: the field starts again from it.
                    , { settingKey: f.key, label: f.label, placeholder: f.placeholder, saved: values[f.key], users: messagesUsing(templates, live, LINK_PLACEHOLDER[f.key]).length, canEdit: canEdit, onSave: onSave }, `${f.key}:${values[f.key] ?? ""}`)))] }), _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [_jsx(SubHeading, { children: "Automated Discord posts" }), _jsx(SwitchRow, { view: master, canEdit: canEdit, onSave: onSave, confirmOn: masterTurnOnText(values) }), _jsx("p", { style: { ...T.bodyDim, lineHeight: 1.5 }, children: "Each switch below acts only while the master switch is on." }), others.map((v) => (_jsx(SwitchRow, { view: v, canEdit: canEdit, onSave: onSave }, v.key)))] })] }));
}
function LinkField({ settingKey, label, placeholder, saved, users, canEdit, onSave, }) {
    const id = useId();
    const [draft, setDraft] = useState(saved ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const placeholderName = `{${LINK_PLACEHOLDER[settingKey]}}`;
    const hint = saved === null
        ? "This setting has no row in the database, so it cannot be saved here."
        : `Fills ${placeholderName} in ${users} ${users === 1 ? "message" : "messages"}.`;
    const changed = saved !== null && draft.trim() !== saved.trim();
    if (!canEdit) {
        return (_jsx(Field, { label: label, htmlFor: id, hint: hint, children: _jsx("p", { id: id, style: { ...T.body, fontSize: 15, overflowWrap: "anywhere" }, children: saved ? saved : _jsx("span", { style: { color: "var(--color-text-secondary)" }, children: "Empty" }) }) }));
    }
    return (_jsxs(Field, { label: label, htmlFor: id, hint: hint, children: [_jsxs("div", { className: "flex flex-wrap", style: { gap: 8 }, children: [_jsx("input", { id: id, type: "url", inputMode: "url", value: draft, disabled: saved === null || busy, placeholder: placeholder, onChange: (e) => {
                            setDraft(e.target.value);
                            setError(null);
                        }, style: { ...INPUT, flex: "1 1 260px", width: "auto", minWidth: 0 } }), _jsx(Button, { variant: "raised", size: "md", busy: busy, disabled: !changed, onClick: async () => {
                            setBusy(true);
                            const said = await onSave(settingKey, draft.trim());
                            setBusy(false);
                            setError(said);
                        }, children: busy ? "Saving" : "Save" })] }), error && (_jsx("p", { role: "alert", style: { ...T.body, lineHeight: 1.5 }, children: error }))] }));
}
function SwitchRow({ view, canEdit, onSave, confirmOn, }) {
    const [busy, setBusy] = useState(false);
    const [asking, setAsking] = useState(false);
    const [error, setError] = useState(null);
    const tone = view.on === null ? "neutral" : view.on ? (view.state === "On" ? "success" : "warning") : "neutral";
    async function set(on) {
        setBusy(true);
        setError(null);
        const said = await onSave(view.key, on ? "true" : "false");
        setBusy(false);
        setAsking(false);
        setError(said);
    }
    return (_jsxs("div", { style: {
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 14,
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
        }, children: [_jsxs("div", { className: "flex flex-wrap items-start", style: { gap: 12 }, children: [_jsxs("div", { style: { flex: "1 1 240px", minWidth: 0 }, children: [_jsx("p", { style: { ...T.body, fontSize: 15, fontWeight: 600 }, children: view.title }), _jsx("p", { style: { ...T.bodyDim, marginTop: 2, lineHeight: 1.5 }, children: view.description })] }), _jsxs("div", { className: "flex flex-wrap items-center", style: { gap: 8 }, children: [_jsx(Pill, { tone: tone, children: view.state }), canEdit && view.on !== null && !asking && (_jsx(Button, { variant: "raised", size: "md", busy: busy, onClick: () => {
                                    if (!view.on && confirmOn)
                                        setAsking(true);
                                    else
                                        void set(!view.on);
                                }, children: view.on ? "Turn off" : "Turn on" }))] })] }), asking && confirmOn && (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [_jsxs("p", { style: { ...T.body, lineHeight: 1.5 }, children: ["Turn on automated Discord posts? ", confirmOn] }), _jsxs("div", { className: "flex flex-wrap", style: { gap: 8 }, children: [_jsx(Button, { variant: "raised", size: "md", busy: busy, onClick: () => void set(true), children: "Yes, turn on" }), _jsx(Button, { variant: "ghost", size: "md", disabled: busy, onClick: () => setAsking(false), children: "Cancel" })] })] })), error && (_jsx("p", { role: "alert", style: { ...T.body, lineHeight: 1.5 }, children: error }))] }));
}
