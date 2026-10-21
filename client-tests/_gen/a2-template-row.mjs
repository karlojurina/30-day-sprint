"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useId, useState } from "react";
import { Button, Pill, T } from "./a2-ui.mjs";
import { TemplateOnOff } from "./a2-template-on-off-view.mjs";
import { TriggerBuilder } from "./a2-trigger-builder.mjs";
import { onOffView } from "./template-on-off.ts";
import { renderTemplate, stripBucketGlyph } from "./a2-templates.ts";
import { BUCKET_OPTIONS, BUCKET_WORDS, canDelete, isDirty, previewConfig, unresolvedLine, } from "./templates-data.ts";
import { Field, INPUT, TEXTAREA } from "./a2-form-parts.mjs";
/**
 * One template on /admin/templates (admin rebuild 2, WI-8): its line in the
 * list (title, bucket in words, its numbers, Off where its switch works, any
 * unsaved change), and when open, the editor: on or off, the fields, the
 * conditions, the message, its preview, Save and, for a custom template
 * only, Delete.
 *
 * The preview fills {programLink} and {discordInvite} with the live message
 * settings (previewConfig), never a host written here; a placeholder left as
 * written gets a line saying why.
 */
/** The made-up student the preview is written to. Read once, at load. */
const SAMPLE_STUDENT = {
    name: "Mike Smith",
    joined_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
};
export function TemplateRow({ template: t, draft, open, stat, live, trigger, settings, canEdit, busy, handlers, }) {
    const panelId = useId();
    const dirty = isDirty(t, draft);
    // The on/off switch, only where it stops the template's tasks, and why Turn on waits (template-on-off.ts).
    const onOff = onOffView(t, live, dirty);
    const meta = [BUCKET_WORDS[t.bucket] ?? t.bucket, ...statWords(stat)].join(" · ");
    return (_jsxs("div", { className: "list-row", style: {
            flexDirection: "column",
            alignItems: "stretch",
            padding: 0,
            boxShadow: dirty ? "inset 3px 0 0 var(--color-accent-dark)" : undefined,
        }, children: [_jsxs("button", { type: "button", "aria-expanded": open, "aria-controls": panelId, onClick: handlers.onToggleOpen, className: "w-full text-left", style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 64,
                    padding: "12px 16px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "inherit",
                }, children: [_jsxs("span", { style: { flex: "1 1 auto", minWidth: 0 }, children: [_jsx("span", { style: { ...T.body, display: "block", fontSize: 15, fontWeight: 600, lineHeight: 1.35 }, children: stripBucketGlyph(t.title) }), _jsx("span", { style: { ...T.bodyDim, display: "block", marginTop: 2, lineHeight: 1.45 }, children: meta })] }), _jsxs("span", { className: "flex flex-wrap items-center justify-end", style: { gap: 6, flex: "none", maxWidth: "45%" }, children: [onOff.kind === "switch" && !onOff.on && _jsx(Pill, { tone: "warning", children: "Off" }), t.is_admin_only && _jsx(Pill, { tone: "neutral", children: "Admin only" }), dirty && _jsx(Pill, { tone: "accent", children: "Unsaved" })] }), _jsx("svg", { "aria-hidden": "true", width: "16", height: "16", viewBox: "0 0 16 16", style: { flex: "none", transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }, children: _jsx("path", { d: "M4 6l4 4 4-4", fill: "none", stroke: "var(--color-text-secondary)", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }) })] }), open && (_jsxs("div", { id: panelId, style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    padding: "4px 16px 18px",
                }, children: [_jsx(TemplateOnOff, { view: onOff, canEdit: canEdit, busy: busy, onToggle: handlers.onSetActive }), canEdit ? (_jsx(EditFields, { template: t, draft: draft, trigger: trigger, busy: busy, onDraft: handlers.onDraft })) : (_jsx(ReadFields, { template: t, trigger: trigger })), !t.is_admin_only && (_jsx(RowActions, { template: t, draft: draft, settings: settings, canEdit: canEdit, dirty: dirty, busy: busy, onSave: handlers.onSave, onDelete: handlers.onDelete }))] }))] }));
}
/** "32 sent", "40% success", "8 graded on the old course", "3 replied": what the row shows of the template's numbers. */
export function statWords(s) {
    if (!s || s.created === 0)
        return [];
    const out = [`${s.sent} sent`];
    if (s.success_eligible > 0)
        out.push(`${Math.round((s.success / s.success_eligible) * 100)}% success`);
    if (s.graded_on_old_course > 0)
        out.push(`${s.graded_on_old_course} graded on the old course`);
    if (s.replied > 0)
        out.push(`${s.replied} replied`);
    return out;
}
function EditFields({ template: t, draft, trigger, busy, onDraft, }) {
    const id = useId();
    const set = (k, v) => onDraft({ ...draft, [k]: v });
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "Title", htmlFor: `${id}-title`, children: _jsx("input", { id: `${id}-title`, type: "text", value: draft.title, disabled: busy, onChange: (e) => set("title", e.target.value), style: INPUT }) }), _jsx(Field, { label: "Bucket", htmlFor: `${id}-bucket`, hint: "What kind of moment this is. Tasks sort by it.", children: _jsx("select", { id: `${id}-bucket`, value: draft.bucket, disabled: busy, onChange: (e) => set("bucket", e.target.value), style: INPUT, children: BUCKET_OPTIONS.map((b) => (_jsx("option", { value: b, children: BUCKET_WORDS[b] }, b))) }) }), _jsx(TriggerBuilder, { value: draft.trigger_config, disabled: busy, catalog: trigger, onChange: (next) => set("trigger_config", next) }), !t.is_custom && (_jsx(Field, { label: "Trigger note", htmlFor: `${id}-note`, hint: "For the team only: when this message comes up, in words. The conditions above decide it.", children: _jsx("textarea", { id: `${id}-note`, rows: 2, value: draft.trigger_description, disabled: busy, onChange: (e) => set("trigger_description", e.target.value), style: TEXTAREA }) })), _jsx(Field, { label: "Intent", htmlFor: `${id}-intent`, hint: "What the message is trying to do.", children: _jsx("textarea", { id: `${id}-intent`, rows: 2, value: draft.intent, disabled: busy, onChange: (e) => set("intent", e.target.value), style: TEXTAREA }) }), !t.is_admin_only ? (_jsx(Field, { label: "Message", htmlFor: `${id}-body`, hint: "{firstName}, {fullName}, {dayNumber}, {programLink} and {discordInvite} are filled in when a task copies it.", children: _jsx("textarea", { id: `${id}-body`, rows: Math.max(8, Math.min(24, draft.body.split("\n").length + 1)), value: draft.body, disabled: busy, onChange: (e) => set("body", e.target.value), style: TEXTAREA }) })) : (_jsx("p", { style: { ...T.bodyDim, lineHeight: 1.5 }, children: "This one shows in the team's task list only. It sends nothing to a student, so it has no message." }))] }));
}
/** What a team member who cannot edit sees: the same fields as text. */
function ReadFields({ template: t, trigger }) {
    return (_jsxs(_Fragment, { children: [_jsx(TriggerBuilder, { value: t.trigger_config ?? { all: [] }, disabled: true, catalog: trigger, onChange: () => { } }), !t.is_custom && t.trigger_description && _jsx(ReadText, { label: "Trigger note", text: t.trigger_description }), t.intent && _jsx(ReadText, { label: "Intent", text: t.intent }), !t.is_admin_only && _jsx(ReadText, { label: "Message", text: t.body || "No message yet." })] }));
}
function ReadText({ label, text }) {
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [_jsx("p", { style: { ...T.eyebrow, color: "var(--color-text-secondary)" }, children: label }), _jsx("p", { style: { ...T.body, fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, children: text })] }));
}
function RowActions({ template: t, draft, settings, canEdit, dirty, busy, onSave, onDelete, }) {
    const [preview, setPreview] = useState(false);
    const [asking, setAsking] = useState(false);
    const [error, setError] = useState(null);
    const deletable = canEdit && canDelete(t);
    // Delete, red, at the start of the row, away from Preview and Save at its end (the review's fix round).
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { className: "flex flex-wrap items-center", style: { gap: 8 }, children: [deletable && !asking && (_jsx(Button, { variant: "danger", size: "md", disabled: busy, onClick: () => setAsking(true), children: "Delete template" })), _jsxs("span", { className: "flex flex-wrap items-center justify-end", style: { gap: 8, marginLeft: "auto" }, children: [canEdit && !dirty && _jsx("span", { style: T.bodyDim, children: "No changes to save" }), _jsx(Button, { variant: "raised", size: "md", onClick: () => setPreview((p) => !p), children: preview ? "Hide preview" : "Show preview" }), canEdit && (_jsx(Button, { variant: "raised", size: "md", busy: busy, disabled: !dirty, onClick: async () => {
                                    setError(await onSave());
                                }, children: busy ? "Saving" : "Save" }))] })] }), asking && (_jsxs("div", { style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: 12,
                    borderRadius: "var(--radius-control)",
                    background: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                }, children: [_jsx("p", { style: { ...T.body, lineHeight: 1.5 }, children: "Delete this template? Tasks it already made stay in Tasks, without it. This cannot be undone." }), _jsxs("div", { className: "flex flex-wrap", style: { gap: 8 }, children: [_jsx(Button, { variant: "danger", size: "md", busy: busy, onClick: async () => {
                                    const said = await onDelete();
                                    if (said) {
                                        setError(said);
                                        setAsking(false);
                                    }
                                }, children: "Yes, delete it" }), _jsx(Button, { variant: "ghost", size: "md", disabled: busy, onClick: () => setAsking(false), children: "Cancel" })] })] })), error && (_jsx("p", { role: "alert", style: { ...T.body, lineHeight: 1.5 }, children: error })), preview && _jsx(TemplatePreview, { body: draft.body, settings: settings })] }));
}
/** The message as a task would copy it: the sample student's name and the live links. */
export function TemplatePreview({ body, settings }) {
    const rendered = renderTemplate(body, { student: SAMPLE_STUDENT, config: previewConfig(settings) });
    return (_jsxs("div", { style: {
            padding: 14,
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
        }, children: [_jsxs("p", { style: { ...T.eyebrow, color: "var(--color-text-secondary)", marginBottom: 8 }, children: ["Preview for a sample student, ", SAMPLE_STUDENT.name, ", with the live links"] }), _jsx("p", { style: { ...T.body, fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, children: rendered.body }), rendered.unresolved.length > 0 && (_jsx("ul", { style: { marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }, children: rendered.unresolved.map((name) => (_jsx("li", { style: { ...T.body, lineHeight: 1.5, color: "var(--color-warning)" }, children: unresolvedLine(name, settings) }, name))) }))] }));
}
