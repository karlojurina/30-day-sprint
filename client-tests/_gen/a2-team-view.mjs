"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card, EmptyState, Pill, T } from "./a2-ui.mjs";
import { ListHeader, ListPage, LoadError, NoticeStack, SkeletonRows } from "./a2-list-parts.mjs";
import { Field, INPUT } from "./a2-form-parts.mjs";
import { dayLabel } from "./croatia-dates.ts";
import { INVITE_PLACEHOLDER, ROLE_OPTIONS, canRemove, inviteProblem, roleLocked } from "./team-data.ts";
const EMPTY_INVITE = { email: "", full_name: "", role: "admin" };
export function TeamView({ transport, me, }) {
    const isFounder = me.role === "founder";
    const [loaded, setLoaded] = useState({ kind: "loading" });
    const [retrying, setRetrying] = useState(false);
    const [pending, setPending] = useState(null);
    const [notices, setNotices] = useState([]);
    const seq = useRef(0);
    const noticeSeq = useRef(0);
    const notify = useCallback((tone, text) => {
        setNotices([{ id: ++noticeSeq.current, tone, text }]);
    }, []);
    /** One read of the list; null when a newer read started meanwhile (that one's answer wins). */
    const fetchList = useCallback(async () => {
        const mine = ++seq.current;
        const r = await transport.list();
        if (mine !== seq.current)
            return null;
        return r.ok ? { kind: "ready", members: r.data } : { kind: "error", error: r.error };
    }, [transport]);
    const read = useCallback(async () => {
        const next = await fetchList();
        if (next)
            setLoaded(next);
    }, [fetchList]);
    useEffect(() => {
        if (!isFounder)
            return;
        let alive = true;
        void fetchList().then((next) => {
            if (alive && next)
                setLoaded(next);
        });
        return () => {
            alive = false;
        };
    }, [isFounder, fetchList]);
    if (!isFounder) {
        return (_jsxs(ListPage, { children: [_jsx(ListHeader, { title: "Team", description: "Who can sign in to the admin, and their roles." }), _jsx(Card, { padding: 20, children: _jsx("p", { style: { ...T.bodyDim, lineHeight: 1.5 }, children: "Only founders can manage the team. Ask a founder if your role should change." }) })] }));
    }
    async function invite(fields) {
        const r = await transport.invite(fields);
        if (!r.ok)
            return r.error;
        notify("success", `Invited ${r.data.email}. They get an email with a link to set a password.`);
        await read();
        return null;
    }
    async function changeRole(m, role) {
        setPending(m.id);
        const r = await transport.changeRole(m.id, role);
        setPending(null);
        if (!r.ok) {
            notify("danger", `Couldn't change ${m.full_name || m.email}'s role: ${r.error}`);
            return;
        }
        // The row as the route saved it, at once; the read after it brings the rest.
        setLoaded((cur) => cur.kind === "ready" ? { ...cur, members: cur.members.map((x) => (x.id === m.id ? r.data : x)) } : cur);
        notify("success", `${r.data.full_name || r.data.email} is now ${roleLabel(r.data.role)}.`);
        await read();
    }
    async function remove(m) {
        setPending(m.id);
        const r = await transport.remove(m.id);
        setPending(null);
        if (!r.ok)
            return r.error;
        // Gone from the list as soon as the route says so, before the read after it.
        setLoaded((cur) => (cur.kind === "ready" ? { ...cur, members: cur.members.filter((x) => x.id !== m.id) } : cur));
        if (r.data.warning)
            notify("warning", `Removed ${m.email} from the team, but their login could not be deleted: ${r.data.warning}`);
        else
            notify("success", `Removed ${m.email}. Their login is deleted too.`);
        await read();
        return null;
    }
    const header = (meta) => (_jsx(ListHeader, { title: "Team", description: "Who can sign in to the admin, and their roles. Founders only.", meta: meta }));
    return (_jsxs(ListPage, { children: [header(loaded.kind === "ready" ? `${loaded.members.length} ${loaded.members.length === 1 ? "member" : "members"}` : "Loading"), _jsx(InviteCard, { onInvite: invite }), _jsx("h2", { style: { ...T.eyebrow, color: "var(--color-text-secondary)", margin: "24px 0 8px" }, children: "Members" }), loaded.kind === "loading" && _jsx(SkeletonRows, { rows: 3, label: "Loading the team" }), loaded.kind === "error" && (_jsx(LoadError, { title: "Couldn't load the team.", detail: loaded.error, busy: retrying, onRetry: async () => {
                    setRetrying(true);
                    await read();
                    setRetrying(false);
                } })), loaded.kind === "ready" &&
                (loaded.members.length === 0 ? (_jsx(Card, { children: _jsx(EmptyState, { title: "No team members to show." }) })) : (_jsx(Card, { padding: 0, children: loaded.members.map((m) => (_jsx(MemberRow, { member: m, meId: me.id, busy: pending === m.id, onRole: (role) => void changeRole(m, role), onRemove: () => remove(m) }, m.id))) }))), _jsx(NoticeStack, { notices: notices, onClose: (id) => setNotices((n) => n.filter((x) => x.id !== id)) })] }));
}
const roleLabel = (r) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
function InviteCard({ onInvite }) {
    const id = useId();
    const [fields, setFields] = useState(EMPTY_INVITE);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const set = (k, v) => {
        setFields((f) => ({ ...f, [k]: v }));
        setError(null);
    };
    const role = ROLE_OPTIONS.find((o) => o.value === fields.role);
    return (_jsx(Card, { padding: 20, children: _jsxs("form", { noValidate: true, onSubmit: async (e) => {
                e.preventDefault();
                const problem = inviteProblem(fields);
                if (problem) {
                    setError(problem);
                    return;
                }
                setBusy(true);
                const said = await onInvite(fields);
                setBusy(false);
                if (said)
                    setError(said);
                else
                    setFields(EMPTY_INVITE);
            }, style: { display: "flex", flexDirection: "column", gap: 14 }, children: [_jsxs("div", { children: [_jsx("h2", { style: T.cardTitle, children: "Invite a team member" }), _jsx("p", { style: { ...T.bodyDim, marginTop: 4, lineHeight: 1.5 }, children: "They get an email with a link to set a password, then sign in at /admin/login." })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2", style: { gap: 14 }, children: [_jsx(Field, { label: "Email", htmlFor: `${id}-email`, children: _jsx("input", { id: `${id}-email`, type: "email", autoComplete: "off", value: fields.email, placeholder: INVITE_PLACEHOLDER, onChange: (e) => set("email", e.target.value), style: INPUT }) }), _jsx(Field, { label: "Full name", htmlFor: `${id}-name`, children: _jsx("input", { id: `${id}-name`, type: "text", autoComplete: "off", value: fields.full_name, placeholder: "First Last", onChange: (e) => set("full_name", e.target.value), style: INPUT }) }), _jsx(Field, { label: "Role", htmlFor: `${id}-role`, hint: role?.description, children: _jsx("select", { id: `${id}-role`, value: fields.role, onChange: (e) => set("role", e.target.value), style: INPUT, children: ROLE_OPTIONS.map((o) => (_jsx("option", { value: o.value, children: o.label }, o.value))) }) })] }), error && (_jsx("p", { role: "alert", style: { ...T.body, lineHeight: 1.5 }, children: error })), _jsx("div", { children: _jsx(Button, { variant: "ink", size: "md", type: "submit", busy: busy, children: busy ? "Sending the invite" : "Send invite" }) })] }) }));
}
function MemberRow({ member: m, meId, busy, onRole, onRemove, }) {
    const id = useId();
    const [asking, setAsking] = useState(false);
    const [error, setError] = useState(null);
    const self = m.id === meId;
    const locked = roleLocked(m, meId);
    const removable = canRemove(m, meId);
    return (_jsxs("div", { className: "list-row", style: { flexDirection: "column", alignItems: "stretch", gap: 12, padding: 16 }, children: [_jsxs("div", { className: "flex flex-wrap items-center", style: { gap: "12px 16px" }, children: [_jsxs("div", { style: { flex: "1 1 220px", minWidth: 0 }, children: [_jsxs("p", { className: "flex flex-wrap items-center", style: { ...T.body, fontSize: 15, fontWeight: 600, gap: 8 }, children: [_jsx("span", { style: { overflowWrap: "anywhere" }, children: m.full_name || "No name on file" }), self && _jsx(Pill, { tone: "accent", children: "You" })] }), _jsx("p", { style: { ...T.bodyDim, overflowWrap: "anywhere" }, children: m.email }), _jsxs("p", { style: { ...T.bodyDim, marginTop: 2 }, children: ["Added ", dayLabel(m.created_at)] })] }), _jsxs("div", { className: "flex flex-wrap items-center", style: { gap: 8 }, children: [locked ? (_jsx("span", { "data-role-locked": "", children: _jsx(Pill, { tone: "neutral", children: roleLabel(m.role) }) })) : (_jsxs(_Fragment, { children: [_jsxs("label", { htmlFor: `${id}-role`, className: "sr-only", children: ["Role of ", m.full_name || m.email] }), _jsx("select", { id: `${id}-role`, value: m.role, disabled: busy, onChange: (e) => onRole(e.target.value), style: { ...INPUT, width: "auto", minWidth: 140 }, children: ROLE_OPTIONS.map((o) => (_jsx("option", { value: o.value, children: o.label }, o.value))) })] })), removable && !asking && (_jsx(Button, { variant: "ghost", size: "md", disabled: busy, onClick: () => setAsking(true), children: "Remove" }))] })] }), locked && _jsx("p", { style: { ...T.bodyDim, lineHeight: 1.5 }, children: "You can't change your own founder role." }), asking && (_jsxs("div", { style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: 12,
                    borderRadius: "var(--radius-control)",
                    background: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                }, children: [_jsxs("p", { style: { ...T.body, lineHeight: 1.5 }, children: ["Remove ", m.email, "? Their login is deleted too. This cannot be undone."] }), _jsxs("div", { className: "flex flex-wrap", style: { gap: 8 }, children: [_jsx(Button, { variant: "danger", size: "md", busy: busy, onClick: async () => {
                                    const said = await onRemove();
                                    if (said)
                                        setError(said);
                                    setAsking(false);
                                }, children: "Yes, remove" }), _jsx(Button, { variant: "ghost", size: "md", disabled: busy, onClick: () => setAsking(false), children: "Cancel" })] })] })), error && (_jsx("p", { role: "alert", style: { ...T.body, lineHeight: 1.5 }, children: error }))] }));
}
