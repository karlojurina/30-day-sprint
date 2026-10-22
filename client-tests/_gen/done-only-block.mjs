"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from "react";
import { PASTE_LINK_FIRST, actionItemView, checkDiscordLink, } from "./action-items.ts";
const u = new Proxy({}, { get: (_, k) => (typeof k === "string" ? k : undefined) });
/** Said when the request never got an answer. */
const NO_ANSWER = "Couldn't reach the server. Nothing was saved, so try again.";
/**
 * An action item's hand-in, on the lesson page under the lesson's text (or
 * under the Milestone box when there is no text): the old dashboard's flow
 * (src/components/map/LessonSheet.tsx, DiscordLinkBlock and the "Mark ad
 * shipped" button) in the new page's look.
 *
 *   empty      a field for the Discord message link, and Save
 *   saved      the link (it opens Discord), Edit link, and the complete button
 *   completed  "Completed on <date>." and the link, still editable
 *
 * An error shows under any of them. The link is checked before any request by
 * checkDiscordLink (src/lib/world/action-items.ts), the same rule and message
 * the route answers with. The complete button is there once a link is saved,
 * as in the old app, whether or not the video was watched: on a video lesson
 * it completes the action half and the lesson is done once both halves are
 * (the page says so); on a lesson with no video half it completes the lesson.
 *
 * The state comes from the student's row (`row`), as the context holds it;
 * this component only keeps what is being typed. The caller gives it a `key`
 * per lesson, so nothing typed carries over to the next lesson.
 *
 * DONE ONLY (`doneOnly`, the owner, 2026-10-22): an action item with nothing
 * to post (isDoneOnly in action-items.ts: DONE_ONLY_ACTION_ITEMS, seven of the
 * course's ten) has no field, no link and no word of Discord. The Milestone
 * box above says what to do; this block holds one button, Done, which calls
 * `onComplete` as the complete button does, so the same request makes the
 * same writes. Then it says "Completed on <date>." and nothing else, whatever
 * link the row may hold from before. On a video lesson whose video is not
 * watched yet Done completes the action half alone, and the line says "Action
 * completed on <date>. Watch the video to finish the lesson." until it is, as
 * the other kind's does. data-hand-in tells the two kinds apart ("link",
 * "done").
 */
export function ActionItemBlock({ doneOnly = false, separateWatchHalf, row, onSave, onComplete, }) {
    const view = actionItemView(row, separateWatchHalf, doneOnly);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [showSteps, setShowSteps] = useState(false);
    const ids = useId();
    const headingId = `${ids}-heading`;
    const helpId = `${ids}-help`;
    const stepsId = `${ids}-steps`;
    const errorId = `${ids}-error`;
    const inputRef = useRef(null);
    const completeRef = useRef(null);
    const editRef = useRef(null);
    const stateRef = useRef(null);
    // Where the keyboard goes once the next render is on screen: the control
    // that was pressed is often gone by then.
    const focusNext = useRef(null);
    useEffect(() => {
        const want = focusNext.current;
        if (!want)
            return;
        focusNext.current = null;
        const el = want === "input"
            ? inputRef.current
            : want === "state"
                ? stateRef.current
                : want === "edit"
                    ? editRef.current
                    : (completeRef.current ?? editRef.current);
        // preventScroll: a focus must never move the page, whose scroll is the map's camera.
        el?.focus({ preventScroll: true });
    });
    const showForm = view.state === "empty" || editing;
    // On a video lesson whose video is not watched yet, the button completes the action only.
    const completesLesson = !separateWatchHalf || !!row?.completed_at;
    async function save(e) {
        e.preventDefault();
        if (busy)
            return;
        const checked = checkDiscordLink(draft);
        if (!checked.ok) {
            setError(checked.error);
            return;
        }
        if (checked.link === null) {
            // Save pressed with nothing in the field.
            setError(PASTE_LINK_FIRST);
            return;
        }
        if (checked.link === view.link) {
            // Nothing changed: back to the saved link, no request.
            setError(null);
            setEditing(false);
            focusNext.current = "edit";
            return;
        }
        setError(null);
        setBusy("save");
        let failure;
        try {
            failure = await onSave(checked.link);
        }
        catch {
            failure = NO_ANSWER;
        }
        setBusy(null);
        if (failure) {
            setError(failure);
            focusNext.current = "input";
            return;
        }
        setEditing(false);
        focusNext.current = "after-save";
    }
    async function complete() {
        if (busy || !view.canComplete)
            return;
        setError(null);
        setBusy("complete");
        let failure;
        try {
            failure = await onComplete();
        }
        catch {
            failure = NO_ANSWER;
        }
        setBusy(null);
        if (failure) {
            setError(failure);
            focusNext.current = "after-save";
            return;
        }
        focusNext.current = "state";
    }
    function edit() {
        setDraft(view.link ?? "");
        setError(null);
        setEditing(true);
        focusNext.current = "input";
    }
    function cancel() {
        setDraft("");
        setError(null);
        setEditing(false);
        focusNext.current = "edit";
    }
    const day = view.completedAt ? dayOf(view.completedAt) : null;
    const completedLine = view.state === "completed" && view.completedAt && (
    // Focused after the complete button, which is gone by then. Not a control: no ring.
    _jsxs("p", { ref: stateRef, tabIndex: -1, className: u.submitState, children: [_jsx("span", { className: u.doneDot, "aria-hidden": "true" }), _jsxs("span", { children: [view.waitingOnVideo ? "Action completed on " : "Completed on ", _jsx("time", { dateTime: view.completedAt, children: day }), ".", view.waitingOnVideo && " Watch the video to finish the lesson."] })] }));
    const errorLine = error && (_jsxs("p", { id: errorId, role: "alert", className: u.submitError, children: [_jsx("span", { className: u.errorMark, "aria-hidden": "true" }), _jsx("span", { children: error })] }));
    if (doneOnly) {
        return (_jsxs("section", { className: u.submit, "aria-label": "Action item", "data-action-item": view.state, "data-hand-in": "done", children: [completedLine, view.canComplete && (_jsx("div", { className: u.submitActions, children: _jsx("button", { ref: completeRef, type: "button", className: u.primary, onClick: complete, disabled: busy !== null, children: busy === "complete" ? "Saving…" : "Done" }) })), errorLine] }));
    }
    return (_jsxs("section", { className: u.submit, "aria-labelledby": headingId, "data-action-item": view.state, "data-hand-in": "link", children: [_jsx("h2", { id: headingId, className: u.submitLabel, children: "Discord link" }), completedLine, showForm ? (_jsxs(_Fragment, { children: [view.state === "empty" && (_jsx("p", { id: helpId, className: u.submitHelp, children: "Post your work in Discord, then paste the link to your message here." })), _jsx("button", { type: "button", className: u.stepsToggle, "aria-expanded": showSteps, "aria-controls": stepsId, onClick: () => setShowSteps((s) => !s), children: showSteps ? "Hide the steps" : "How do I get the link?" }), _jsxs("ol", { id: stepsId, className: u.steps, hidden: !showSteps, children: [_jsx("li", { children: "Right-click your message in Discord (on a phone, press and hold it)." }), _jsx("li", { children: "Choose Copy Message Link." }), _jsx("li", { children: "Paste it here and press Save." })] }), _jsxs("form", { className: u.field, onSubmit: save, noValidate: true, children: [_jsx("input", { ref: inputRef, type: "url", inputMode: "url", autoComplete: "off", autoCapitalize: "none", spellCheck: false, "aria-labelledby": headingId, "aria-describedby": [view.state === "empty" ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined, placeholder: "https://discord.com/channels/\u2026", value: draft, onChange: (e) => setDraft(e.target.value), className: u.input }), _jsx("button", { type: "submit", className: u.primary, disabled: busy !== null, children: busy === "save" ? "Saving…" : "Save" }), editing && (_jsx("button", { type: "button", className: u.secondary, onClick: cancel, disabled: busy !== null, children: "Cancel" }))] })] })) : (_jsxs("div", { className: u.saved, children: [view.link ? (_jsxs(_Fragment, { children: [view.state === "saved" && _jsx("span", { className: u.savedNote, children: "Link saved:" }), _jsxs("a", { href: view.link, target: "_blank", rel: "noopener noreferrer", className: u.savedLink, children: [view.link.replace(/^https:\/\//, ""), _jsx("span", { className: "sr-only", children: " (opens Discord in a new tab)" })] })] })) : (_jsx("span", { className: u.savedNote, children: "No link saved." })), _jsx("button", { ref: editRef, type: "button", className: u.secondary, onClick: edit, disabled: busy !== null, children: view.link ? "Edit link" : "Add a link" })] })), view.canComplete && !editing && (_jsx("div", { className: u.submitActions, children: _jsx("button", { ref: completeRef, type: "button", className: u.primary, onClick: complete, disabled: busy !== null, children: busy === "complete" ? "Completing…" : completesLesson ? "Complete lesson" : "Complete the action" }) })), errorLine] }));
}
/** "Oct 14, 2026", as the old dashboard writes a date. Empty for a value that is not a date. */
function dayOf(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
