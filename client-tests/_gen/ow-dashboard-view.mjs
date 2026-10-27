"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createElement as __ce } from "react"; const Link = ({ href, children, ...rest }) => __ce("a", { href, ...rest }, children);
import { useCallback, useEffect, useId, useRef, useState } from "react";
const tokens = {};
import { FailedMeta, ListHeader, ListPage, TAP } from "./ow-list-parts.mjs";
import { FailureList } from "./ow-review-parts.mjs";
import { Button, Card, T } from "./ow-ui.mjs";
import { clockLabel, dayLabel } from "./croatia-dates.ts";
import { allFailed, bountyTrend, buildDashboard, deltaOf, momentMs, nothingLoaded, refreshSummary, } from "./dashboard-metrics.ts";
import { DISCOUNT_LAUNCH_DATE } from "./discount.ts";
import { TrendChart, pointDay } from "./ow-trend-chart.mjs";
const ACCENT = "var(--color-accent-dark)";
/** How long Refresh's line stays (the old page's 12 seconds). */
const NOTE_MS = 12_000;
const LAUNCH_DAY = dayLabel(DISCOUNT_LAUNCH_DATE);
const int = (n) => n.toLocaleString("en-US");
/** "1 Oct": a day and its month, as a tile's source line names a date. */
const dayMonth = (iso) => dayLabel(iso).replace(/^\S+ /, "");
const pct0 = (v) => `${Math.round(v)}%`;
const pct1 = (v) => `${v.toFixed(1)}%`;
const pct2 = (v) => `${v.toFixed(2)}%`;
const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many}`;
/** "Wed 21 Oct" for a moment as admin_config holds it (ISO, or Postgres's own text, which browsers parse differently). */
const momentDay = (value) => {
    const ms = momentMs(value);
    return ms === null ? value : dayLabel(new Date(ms).toISOString());
};
export function DashboardView({ source, canRefresh, now = Date.now, }) {
    const [model, setModel] = useState(null);
    const [reloading, setReloading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [note, setNote] = useState(null);
    const noteTimer = useRef(null);
    const alive = useRef(true);
    /** Every read, then every tile, at one moment. */
    const compute = useCallback(async () => {
        const nowMs = now();
        let reads;
        try {
            reads = await source.load(nowMs);
        }
        catch (e) {
            reads = allFailed(e instanceof Error ? e.message : String(e));
        }
        return buildDashboard(reads, nowMs);
    }, [source, now]);
    useEffect(() => {
        // Set here as well as cleared: React's development mode mounts twice.
        alive.current = true;
        return () => {
            alive.current = false;
            if (noteTimer.current)
                clearTimeout(noteTimer.current);
        };
    }, []);
    useEffect(() => {
        let current = true;
        void compute().then((m) => {
            if (current)
                setModel(m);
        });
        return () => {
            current = false;
        };
    }, [compute]);
    /** Reads again; the numbers on screen stay until the new ones are in. */
    const read = async () => {
        const m = await compute();
        if (alive.current)
            setModel(m);
    };
    const reload = async () => {
        if (reloading)
            return;
        setReloading(true);
        await read();
        if (alive.current)
            setReloading(false);
    };
    const refresh = async () => {
        if (refreshing)
            return;
        setRefreshing(true);
        setNote(null);
        let answer;
        try {
            answer = await source.refresh();
        }
        catch {
            answer = { status: 0, body: null };
        }
        if (!alive.current)
            return;
        setNote(refreshSummary(answer.status, answer.body));
        if (noteTimer.current)
            clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
        setReloading(true);
        await read();
        if (!alive.current)
            return;
        setReloading(false);
        setRefreshing(false);
    };
    /** Reads every number again: the ordinary reload, for every role. */
    const reloadButton = (_jsx(Button, { variant: "raised", size: "md", busy: reloading && !refreshing, disabled: !model || refreshing, onClick: () => void reload(), children: "Refresh" }, "reload"));
    const syncButton = canRefresh ? (_jsx(Button, { variant: "raised", size: "md", busy: refreshing, onClick: () => void refresh(), title: "Syncs Whop, rebuilds the snapshots and runs the task checks, then reads every number again. Takes about 2 minutes.", children: refreshing ? "Syncing, about 2 minutes" : "Sync Whop and rebuild" }, "sync")) : null;
    // While a read failed, Retry in the line at the top is the reload: no Refresh beside it.
    const failed = model ? model.failed.length > 0 : false;
    const header = (meta) => (_jsx(ListHeader, { title: "Dashboard", description: "How the program is doing, and what is waiting for the team.", meta: meta, actions: [failed ? null : reloadButton, syncButton].filter((b) => b !== null) }));
    if (!model) {
        return (_jsxs(ListPage, { children: [header("Loading"), _jsx(DashboardSkeleton, {})] }));
    }
    const busyNote = refreshing ? "Syncing Whop and rebuilding, about 2 minutes" : reloading ? "Updating" : null;
    // Every tile failed: nothing was read just now, so the header says so as every page's does (FailedMeta), never
    // "Updated 10:30" (the render review's second round).
    const meta = nothingLoaded(model) ? (_jsx(FailedMeta, { text: busyNote ? `Couldn't load · ${busyNote}` : "Couldn't load" })) : ([`Updated ${clockLabel(model.generatedAt)}`, busyNote].filter(Boolean).join(" · "));
    const waiting = model.monthTwo.ok && model.monthTwo.value.kind === "waiting" ? model.monthTwo.value : null;
    return (_jsxs(ListPage, { children: [header(meta), note && _jsx(RefreshNote, { note: note }), failed && _jsx(FailedReads, { model: model, onRetry: () => void reload(), busy: reloading }), _jsxs("section", { "aria-labelledby": "dash-today", children: [_jsx(SectionTitle, { id: "dash-today", children: "Today" }), _jsxs("div", { className: "grid grid-cols-2", style: { gap: 12 }, children: [_jsx(CountTile, { tileName: "open-tasks", href: "/admin/tasks", title: "Open tasks", tile: model.openTasks, go: "Go to Tasks", none: "All caught up", source: (v) => (v.since ? `Created since the reset, ${momentDay(v.since)}` : "Every task still to do") }), _jsx(CountTile, { tileName: "needs-hand", href: "/admin/discounts", title: "30% needs a hand", tile: model.needsHand, go: "Go to 30% off", none: "Nothing waiting", source: () => "Requests still waiting 30 minutes after the student applied" })] })] }), _jsxs("section", { style: { marginTop: SECTION_GAP }, "aria-labelledby": "dash-program", children: [_jsx(SectionTitle, { id: "dash-program", children: "The program" }), _jsxs("div", { className: waiting ? "grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3", style: { gap: 16 }, children: [_jsx("div", { "data-program-slot": "bounty", className: waiting ? "flex md:col-span-2" : "flex", style: { minWidth: 0 }, children: _jsx(BountyCard, { tile: model.bounty }) }), _jsx("div", { "data-program-slot": "month2", className: "flex", style: { minWidth: 0 }, children: waiting ? _jsx(MonthTwoCompact, { m: waiting, nowMs: Date.parse(model.generatedAt) }) : _jsx(MonthTwoCard, { tile: model.monthTwo }) }), _jsx("div", { "data-program-slot": "thirty", className: "grid", style: { minWidth: 0 }, children: _jsx(CountTile, { tileName: "thirty-applied", href: "/admin/insights/progress", title: "30% off applied", tile: model.thirtyApplied, go: "See it on Insights", none: "None yet", source: (v) => `Codes on students' Whop memberships, requests from ${dayMonth(v.since)}` }) })] })] }), _jsxs("section", { style: { marginTop: SECTION_GAP }, "aria-labelledby": "dash-trends", children: [_jsx(SectionTitle, { id: "dash-trends", action: _jsxs(Link, { href: "/admin/insights/progress", style: {
                                minHeight: TAP,
                                // A 44px target that takes no more of the row than its words: the three titles stay as tall as each other.
                                margin: "-12px 0",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                color: ACCENT,
                                textDecoration: "none",
                                whiteSpace: "nowrap",
                            }, children: ["Open Insights ", _jsx("span", { "aria-hidden": "true", children: "\u2192" })] }), children: "Trends \u00B7 last 14 days" }), _jsxs("div", { className: "grid grid-cols-2 lg:grid-cols-4", style: { gap: 12 }, children: [_jsx(ActiveTile, { tile: model.active }), _jsx(CancelingTile, { tile: model.canceling }), _jsx(ChurnedTile, { tile: model.churned }), _jsx(AvgProgressTile, { tile: model.avgProgress })] })] })] }));
}
// ── Page pieces ─────────────────────────────────────────────────────────────
/** The space above the program and the trends: the three sections sit the same distance apart. */
const SECTION_GAP = 40;
/**
 * A section's title row: 20px tall and 12px above the section's cards on
 * every section, so the three sit the same distance apart; an action (the
 * trends' "Open Insights") on its right, its 44px target hanging over the row.
 */
function SectionTitle({ id, children, action }) {
    return (_jsxs("div", { "data-section-title": "", className: "flex items-center justify-between", style: { gap: 12, minHeight: 20, marginBottom: 12 }, children: [_jsx("h2", { id: id, style: T.eyebrow, children: children }), action] }));
}
const DOT = {
    ok: "var(--color-success)",
    warn: "var(--color-warning)",
    err: "var(--color-danger)",
};
/** What Refresh did, under the header, for 12 seconds. */
function RefreshNote({ note }) {
    return (_jsxs("p", { role: note.tone === "err" ? "alert" : "status", style: { display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16, ...T.body, lineHeight: 1.5 }, children: [_jsx("span", { "aria-hidden": "true", style: { flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: DOT[note.tone] } }), _jsx("span", { style: { overflowWrap: "anywhere" }, children: note.text })] }));
}
/**
 * The reads that failed, with Retry: why, in plain words, each reason once;
 * the reads by name with the database's own words behind Details. The tiles
 * they feed say "Couldn't load" and nothing more.
 */
function FailedReads({ model, onRetry, busy }) {
    const tiles = [
        model.monthTwo,
        model.bounty,
        model.openTasks,
        model.needsHand,
        model.thirtyApplied,
        model.active,
        model.canceling,
        model.churned,
        model.avgProgress,
    ];
    const everything = tiles.every((t) => !t.ok);
    return (_jsx(Card, { padding: 0, style: { marginBottom: 24, borderColor: "var(--color-border-strong)" }, children: _jsxs("div", { role: "alert", className: "flex flex-wrap items-start", style: { gap: 12, padding: 16 }, children: [_jsxs("div", { style: { flex: "1 1 280px", minWidth: 0 }, children: [_jsxs("p", { style: { display: "flex", gap: 10, alignItems: "center", ...T.body, fontSize: 15, fontWeight: 600, marginBottom: 4 }, children: [_jsx("span", { "aria-hidden": "true", style: { flex: "none", width: 8, height: 8, borderRadius: 999, background: "var(--color-warning)" } }), everything ? "Couldn't load the dashboard." : "Some numbers couldn't load."] }), _jsx(FailureList, { failures: model.failed })] }), _jsx(Button, { variant: "raised", size: "md", busy: busy, onClick: onRetry, children: "Retry" })] }) }));
}
/** "Couldn't load" in place of a number. Why is said once, in the line at the top of the page. */
function Failed({ big = false }) {
    return (_jsx("div", { "data-failed": "", style: { marginTop: big ? 14 : 10 }, children: _jsxs("p", { style: { display: "flex", gap: 8, alignItems: "center", fontSize: big ? 22 : 17, fontWeight: 600, color: "var(--color-text-primary)", lineHeight: 1.2 }, children: [_jsx("span", { "aria-hidden": "true", style: { flex: "none", width: 8, height: 8, borderRadius: 999, background: "var(--color-warning)" } }), "Couldn't load"] }) }));
}
/** A tile's header: its name, and the "How it's counted" button when it has one. */
function TileHead({ title, level = 3, info, }) {
    const H = level === 2 ? "h2" : "h3";
    return (_jsxs("div", { className: "flex items-center justify-between", style: { gap: 8, minHeight: 20 }, children: [_jsx(H, { style: { ...T.eyebrow, minWidth: 0 }, children: title }), info && (_jsx("button", { id: `${info.id}-button`, type: "button", className: tokens.dashInfo, "aria-expanded": info.open, "aria-controls": info.id, "aria-label": `How ${title} is counted`, title: "How it's counted", onClick: (e) => info.onToggle(e.currentTarget), style: {
                    flex: "none",
                    width: TAP,
                    height: TAP,
                    // A 44px target that takes no more room than its 20px ring.
                    margin: -12,
                    marginLeft: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    borderRadius: 999,
                    background: "transparent",
                    cursor: "pointer",
                    color: "var(--color-text-secondary)",
                }, children: _jsx("span", { "aria-hidden": "true", style: {
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        border: "1px solid var(--color-border-strong)",
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: "18px",
                        textAlign: "center",
                        transition: "color var(--duration-quick) var(--ease-default), border-color var(--duration-quick) var(--ease-default)",
                    }, children: "i" }) }))] }));
}
/** The rule behind a tile, open under it while its button is pressed. */
/**
 * The rule behind a tile, floating over the tile under its header while its
 * button is pressed: in the page's flow it would stretch the whole row and
 * drop the other tiles' lines to their feet. Escape or a press outside it
 * closes it. The kit allows a shadow on what floats. Its width and side are
 * set when it opens (useInfo), so on a phone's narrow tile it is still wide
 * enough to read and stays inside the window.
 */
function HowCounted({ info, top, children }) {
    const place = info.place
        ? { width: info.place.width, [info.place.side]: 12 }
        : { left: 12, right: 12 };
    return (_jsx("div", { id: info.id, hidden: !info.open, style: {
            position: "absolute",
            ...place,
            top,
            zIndex: 4,
            padding: "12px 14px",
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-strong)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
            ...T.bodyDim,
            fontSize: 13,
            lineHeight: 1.55,
        }, children: children }));
}
/** The panel's width: its tile's inside, or 340px when the tile is narrower (and never wider than the window allows). */
const PANEL_MAX = 340;
/** A tile's "How it's counted": open or not, closed by Escape (focus back on its button) or a press outside. */
function useInfo() {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState(null);
    useEffect(() => {
        if (!open)
            return;
        // Found by id when an event comes: the panel and its button.
        const panel = () => document.getElementById(id);
        const button = () => document.getElementById(`${id}-button`);
        const onKey = (e) => {
            if (e.key !== "Escape")
                return;
            setOpen(false);
            button()?.focus();
        };
        const onDown = (e) => {
            const t = e.target;
            if (t && (panel()?.contains(t) || button()?.contains(t)))
                return;
            setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onDown);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onDown);
        };
    }, [open, id]);
    const onToggle = (button) => {
        if (open) {
            setOpen(false);
            return;
        }
        const tile = button.closest("[data-tile]");
        if (tile) {
            const r = tile.getBoundingClientRect();
            const room = document.documentElement.clientWidth;
            const width = Math.max(r.width - 24, Math.min(PANEL_MAX, room - 32));
            setPlace({ width, side: r.left + 12 + width <= room - 16 ? "left" : "right" });
        }
        setOpen(true);
    };
    return { id, open, place, onToggle };
}
/**
 * The charts' heights (the owner's review, 2026-10-21): the room the source
 * lines took under the tiles went to the charts. The program's two charts,
 * and each trend tile's line.
 */
const BOUNTY_CHART = 156;
const MONTH2_CHART = 144;
const TREND_CHART = 76;
/** A big number, in proportional figures (the kit's rule for a number that stands alone). */
function BigNumber({ children, size }) {
    return (_jsx("p", { "data-number": "", style: {
            fontSize: size,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: "var(--color-text-primary)",
            fontVariantNumeric: "proportional-nums",
        }, children: children }));
}
/**
 * The change from the first reading of a line to its last: the arrow in the
 * status colour (green when the move is good, red when it is bad, grey when
 * flat), the words in the readable grey, so the colour is never alone.
 */
function DeltaLine({ delta, upIsGood, decimals = 0, unit = null, }) {
    if (!delta)
        return null;
    const f = 10 ** decimals;
    const size = Math.round(Math.abs(delta.change) * f) / f;
    const since = `since ${pointDay(delta.from)}`;
    if (size === 0) {
        return (_jsxs("p", { style: { marginTop: 8, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }, children: [_jsx("span", { "aria-hidden": "true", style: { color: "var(--color-neutral)", marginRight: 4 }, children: "\u2192" }), "No change ", since] }));
    }
    const up = delta.change > 0;
    const good = up === upIsGood;
    const amount = decimals > 0 ? String(size) : int(size);
    return (_jsxs("p", { style: { marginTop: 8, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }, children: [_jsx("span", { "aria-hidden": "true", style: { color: good ? "var(--color-success)" : "var(--color-danger)", marginRight: 4 }, children: up ? "↑" : "↓" }), _jsx("span", { className: "sr-only", children: up ? "Up " : "Down " }), amount, unit ? ` ${size === 1 ? unit[0] : unit[1]}` : "", " ", since] }));
}
// ── The two north-star numbers ──────────────────────────────────────────────
/** A hero card: the kit's card, 20px of air on a phone, 24px on a wide screen; as tall as its slot in the program row. */
function HeroCard({ tile, children }) {
    return (_jsx(Card, { padding: 0, style: { minWidth: 0, flex: "1 1 auto", display: "flex", flexDirection: "column" }, children: _jsx("div", { "data-tile": tile, className: "p-5 sm:p-6", style: { position: "relative", display: "flex", flexDirection: "column", flex: "1 1 auto" }, children: children }) }));
}
/** Month 2's rule, the same words on its full tile and its compact one. */
function MonthTwoHow() {
    return (_jsxs(_Fragment, { children: ["Of the students on the monthly plan who first paid on or after ", LAUNCH_DAY, ", the share still paying after their first renewal: a week after it they still have access, or it ended later, and they had not booked a cancel by the renewal. Students who paid before ", LAUNCH_DAY, " are not counted. Nothing in the app records payments, so this reads the access Whop gives. The line is the rate at the end of each day."] }));
}
/** Month 2's full tile: its rate and its chart, or "Couldn't load". Until the first rate, MonthTwoCompact stands in. */
function MonthTwoCard({ tile }) {
    const info = useInfo();
    return (_jsxs(HeroCard, { tile: "month2", children: [_jsx(TileHead, { title: "Month 2 conversion", level: 2, info: info }), !tile.ok ? _jsx(Failed, { big: true }) : tile.value.kind === "rate" ? _jsx(MonthTwoRate, { m: tile.value }) : null, _jsx(HowCounted, { info: info, top: 56, children: _jsx(MonthTwoHow, {}) })] }));
}
function MonthTwoRate({ m }) {
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap items-baseline", style: { gap: "6px 12px", marginTop: 14 }, children: [_jsx(BigNumber, { size: 56, children: pct0(m.rate * 100) }), _jsxs("p", { style: { ...T.bodyDim, fontSize: 13 }, children: [int(m.converted), " of ", plural(m.resolved, "student", "students"), " still paying after their first renewal"] })] }), _jsx(DeltaLine, { delta: deltaOf(m.line), upIsGood: true, decimals: 0, unit: ["pt", "pts"] }), _jsx("div", { style: { marginTop: "auto", paddingTop: 32 }, children: _jsx(TrendChart, { points: m.line, kind: "line", height: MONTH2_CHART, label: "Month 2 conversion", format: pct0, axis: true, domain: [0, 100], guides: [50, 100], emptyText: "Nobody past a renewal yet" }) })] }));
}
/**
 * Month 2 before its first rate: a compact tile beside the Bounty Program,
 * with no headline of its own. When the first renewals come, the 2 small
 * numbers (paid since the launch, days until the first rate) and the
 * countdown line from the launch to the first rate. With no payment since
 * the launch yet, one line says so.
 */
function MonthTwoCompact({ m, nowMs }) {
    const info = useInfo();
    return (_jsxs(HeroCard, { tile: "month2", children: [_jsx(TileHead, { title: "Month 2 conversion", level: 2, info: info }), _jsx(MonthTwoWaiting, { m: m, nowMs: nowMs }), _jsx(HowCounted, { info: info, top: 56, children: _jsx(MonthTwoHow, {}) })] }));
}
function MonthTwoWaiting({ m, nowMs }) {
    const renewal = dayLabel(`${m.firstRenewalDay}T12:00:00.000Z`);
    if (m.paid === 0 || !m.firstRateAt) {
        return (_jsxs("p", { style: { ...T.bodyDim, marginTop: 12, lineHeight: 1.5 }, children: ["No first payment since ", LAUNCH_DAY, " yet. The rate shows about 5 weeks after the first one, once its first renewal has had a week to go through."] }));
    }
    const startMs = Date.parse(DISCOUNT_LAUNCH_DATE);
    const endMs = Date.parse(m.firstRateAt);
    const done = Math.max(0, Math.min(1, (nowMs - startMs) / Math.max(1, endMs - startMs)));
    const daysLeft = Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000));
    const rateDay = dayLabel(m.firstRateAt);
    const renewalPassed = nowMs >= Date.parse(`${m.firstRenewalDay}T00:00:00.000Z`);
    const stat = { marginTop: 6, fontSize: 12, lineHeight: 1.4, color: "var(--color-text-secondary)" };
    return (_jsxs("div", { style: { marginTop: 12, display: "flex", flexDirection: "column", flex: 1 }, children: [_jsxs("p", { style: { ...T.bodyDim, lineHeight: 1.5 }, children: [renewalPassed ? "First renewals since " : "First renewals from ", _jsx("span", { style: { whiteSpace: "nowrap" }, children: renewal }), ". The rate shows from", " ", _jsx("span", { style: { whiteSpace: "nowrap" }, children: rateDay }), "."] }), _jsxs("div", { className: "grid grid-cols-2", style: { marginTop: 16 }, children: [_jsxs("div", { style: { paddingRight: 12 }, children: [_jsx(BigNumber, { size: 24, children: int(m.paid) }), _jsxs("p", { style: stat, children: ["paid since ", LAUNCH_DAY] })] }), _jsxs("div", { style: { paddingLeft: 12, borderLeft: "1px solid var(--color-border)" }, children: [_jsx(BigNumber, { size: 24, children: daysLeft === 0 ? "Today" : int(daysLeft) }), _jsx("p", { style: stat, children: daysLeft === 0 ? "the first rate shows" : `${daysLeft === 1 ? "day" : "days"} until the first rate` })] })] }), _jsxs("div", { style: { marginTop: "auto", paddingTop: 20 }, children: [_jsx("div", { role: "meter", "aria-label": "Time until the first Month 2 rate", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(done * 100), "aria-valuetext": `${plural(daysLeft, "day", "days")} until ${rateDay}`, style: { height: 6, borderRadius: 999, background: "var(--color-fill-secondary)", overflow: "hidden" }, children: _jsx("div", { style: { width: `${done * 100}%`, height: "100%", borderRadius: 999, background: ACCENT } }) }), _jsxs("div", { className: "flex justify-between", style: { gap: 12, marginTop: 10, fontSize: 12, color: "var(--color-text-secondary)" }, children: [_jsx("span", { children: LAUNCH_DAY }), _jsx("span", { children: rateDay })] })] })] }));
}
/**
 * Beside the Bounty Program's 14-day number (the owner's review,
 * 2026-10-21): a small arrow, green and up when the last 14 days beat the 14
 * days before them, red and down when they hold fewer, nothing when the two
 * are equal (bountyTrend). The earlier count is in its tooltip and in its
 * words for a screen reader; the arrow itself is hidden from one. Exported
 * for client-tests/admin-owner-review.test.mjs, which draws it.
 */
export function BountyArrow({ b }) {
    const trend = bountyTrend(b);
    if (!trend)
        return null;
    const up = trend === "up";
    const before = `${int(b.previous14)} in the 14 days before`;
    return (_jsxs("span", { "data-bounty-arrow": trend, title: before, style: {
            alignSelf: "center",
            fontSize: 22,
            fontWeight: 600,
            lineHeight: 1,
            color: up ? "var(--color-success)" : "var(--color-danger)",
            cursor: "default",
        }, children: [_jsx("span", { "aria-hidden": "true", children: up ? "↑" : "↓" }), _jsx("span", { className: "sr-only", children: `${up ? "Up" : "Down"} from ${before}` })] }));
}
function BountyCard({ tile }) {
    const info = useInfo();
    return (_jsxs(HeroCard, { tile: "bounty", children: [_jsx(TileHead, { title: "Bounty Program \u00B7 joined", level: 2, info: info }), !tile.ok ? (_jsx(Failed, { big: true })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap items-baseline", style: { gap: "6px 12px", marginTop: 14 }, children: [_jsxs("div", { className: "inline-flex items-baseline", style: { gap: 8 }, children: [_jsx(BigNumber, { size: 56, children: int(tile.value.last14) }), _jsx(BountyArrow, { b: tile.value })] }), _jsxs("p", { style: { ...T.bodyDim, fontSize: 13 }, children: ["in the last 14 days \u00B7 ", int(tile.value.allTime), " all time"] })] }), tile.value.last14 === 0 && (_jsx("p", { style: { marginTop: 8, fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }, children: "Nobody joined in these 14 days." })), _jsx("div", { style: { marginTop: "auto", paddingTop: 16 }, children: _jsx(TrendChart, { points: tile.value.line, kind: "bars", height: BOUNTY_CHART, label: "Joined the Bounty Program", format: int, axis: true }) })] })), _jsx(HowCounted, { info: info, top: 56, children: "Students who joined the Bounty Program, by the day the bounty site stamped them (in UTC), among the students on the monthly plan who first paid on or after Mon 25 May. The same count as before the new program." })] }));
}
// ── Today ───────────────────────────────────────────────────────────────────
function CountTile({ tileName, href, title, tile, go, none, source, }) {
    return (_jsx(Link, { href: href, "data-tile": tileName, className: tokens.dashLinkTile, style: { minWidth: 0 }, children: _jsxs("div", { className: "p-4 sm:p-5", style: { display: "flex", flexDirection: "column", height: "100%" }, children: [_jsxs("div", { className: "flex items-center justify-between", style: { gap: 8 }, children: [_jsx("h3", { style: { ...T.eyebrow, minWidth: 0 }, children: title }), _jsx("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", style: { flex: "none", color: "var(--color-text-secondary)" }, children: _jsx("path", { d: "M9 5l7 7-7 7" }) })] }), !tile.ok ? (_jsx(Failed, {})) : (_jsxs(_Fragment, { children: [_jsx("div", { style: { marginTop: 12 }, children: _jsx(BigNumber, { size: 44, children: int(tile.value.count) }) }), _jsx("p", { style: { marginTop: 10, ...T.body, fontWeight: 600, color: tile.value.count > 0 ? ACCENT : "var(--color-text-secondary)" }, children: tile.value.count > 0 ? go : none }), _jsx("p", { style: { marginTop: "auto", paddingTop: 10, fontSize: 12, lineHeight: 1.45, color: "var(--color-text-secondary)" }, children: source(tile.value) })] }))] }) }));
}
// ── Trends ──────────────────────────────────────────────────────────────────
/**
 * A trend tile: its name, the number and its change, then the line at the
 * foot of the tile, so the four lines of a row sit level whatever the words
 * above them take. Where the number comes from is in "How it's counted"
 * alone (the owner's review, 2026-10-21: no source line under the number).
 */
function TrendCard({ tile, title, info, how, chart, children, }) {
    return (_jsx(Card, { padding: 0, style: { minWidth: 0 }, children: _jsxs("div", { "data-tile": tile, className: "p-4", style: { position: "relative", display: "flex", flexDirection: "column", height: "100%" }, children: [_jsx(TileHead, { title: title, info: info }), children, chart, _jsx(HowCounted, { info: info, top: 46, children: how })] }) }));
}
/**
 * A trend tile's line at the foot of the tile, or why there is none. Every
 * line is the 14 days; `from` (Avg progress after the switch) is the day its
 * readings start, said in a small note over the line's right end, where they
 * are drawn.
 */
function Spark({ line, label, format, kind = "line", from = null, }) {
    const note = { marginTop: "auto", paddingTop: 14, fontSize: 12, lineHeight: 1.45, color: "var(--color-text-secondary)", overflowWrap: "anywhere" };
    if (!line.ok)
        return _jsx("p", { style: note, children: "Couldn't load the line" });
    if (!line.value.some((p) => p.value !== null))
        return _jsx("p", { style: note, children: "No snapshot in these 14 days" });
    return (_jsxs("div", { style: { marginTop: "auto", paddingTop: from ? 8 : 22 }, children: [from && (_jsxs("p", { "data-line-from": "", style: { textAlign: "right", fontSize: 12, lineHeight: "14px", color: "var(--color-text-secondary)", marginBottom: 0 }, children: ["From ", pointDay(from)] })), _jsx(TrendChart, { points: line.value, kind: kind, height: TREND_CHART, label: label, format: format, emptyText: from ? (date) => (date < from ? "Before the switch" : "No snapshot") : "No snapshot" })] }));
}
function TrendNumber({ children, unit }) {
    return (_jsxs("div", { className: "flex flex-wrap items-baseline", style: { gap: "2px 6px", marginTop: 12, minWidth: 0 }, children: [_jsx(BigNumber, { size: 30, children: children }), unit && _jsx("span", { style: { fontSize: 12, color: "var(--color-text-secondary)" }, children: unit })] }));
}
function ActiveTile({ tile }) {
    const info = useInfo();
    return (_jsx(TrendCard, { tile: "active", title: "Active on platform", info: info, chart: tile.ok ? _jsx(Spark, { line: tile.value.line, label: "Active on platform", format: int }) : null, how: _jsx(_Fragment, { children: "The number: students on the monthly plan who first paid on or after Mon 25 May, whose Whop status is active or payment failed, now. The line: the nightly snapshot's count for each day, which counts every student of that group whose access had not ended that day. The two are counted differently, so they can differ." }), children: !tile.ok ? (_jsx(Failed, {})) : (_jsxs(_Fragment, { children: [_jsx(TrendNumber, { children: int(tile.value.count) }), _jsx(DeltaLine, { delta: tile.value.line.ok ? deltaOf(tile.value.line.value) : null, upIsGood: true })] })) }));
}
function CancelingTile({ tile }) {
    const info = useInfo();
    return (_jsx(TrendCard, { tile: "canceling", title: "Canceling", info: info, chart: tile.ok ? _jsx(Spark, { line: tile.value.line, label: "Canceling", format: int }) : null, how: _jsx(_Fragment, { children: "Students on the monthly plan since Mon 25 May who pressed cancel in Whop and still have access until the end of what they paid for, now. The line: the count the snapshot took each night." }), children: !tile.ok ? (_jsx(Failed, {})) : (_jsxs(_Fragment, { children: [_jsx(TrendNumber, { children: int(tile.value.count) }), _jsx(DeltaLine, { delta: tile.value.line.ok ? deltaOf(tile.value.line.value) : null, upIsGood: false })] })) }));
}
function ChurnedTile({ tile }) {
    const info = useInfo();
    const read = tile.ok && tile.value.daysRead > 0 ? tile.value : null;
    return (_jsx(TrendCard, { tile: "churned", title: "Churned", info: info, chart: read ? _jsx(Spark, { line: { ok: true, value: read.line }, label: "Churned", format: int, kind: "bars" }) : null, how: _jsx(_Fragment, { children: "Students on the monthly plan since Mon 25 May whose access ended, per day, from the nightly snapshot. The number adds up the days of the last 14 that have a snapshot." }), children: !tile.ok ? (_jsx(Failed, {})) : !read ? (_jsx("p", { style: { marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }, children: "No snapshot in these 14 days" })) : (_jsx(_Fragment, { children: _jsx(TrendNumber, { unit: read.daysRead === 14 ? "in 14 days" : `in ${plural(read.daysRead, "day", "days")} with a snapshot`, children: int(read.total) }) })) }));
}
function AvgProgressTile({ tile }) {
    const info = useInfo();
    const v = tile.ok && tile.value.kind === "value" ? tile.value : null;
    return (_jsx(TrendCard, { tile: "avg-progress", title: "Avg progress", info: info, chart: v ? _jsx(Spark, { line: { ok: true, value: v.line }, label: "Avg progress", format: pct2, from: v.from }) : null, how: _jsx(_Fragment, { children: "One number for the tile and its line: the nightly snapshot's average progress. That is the lessons that count, finished by the students on the monthly plan since Mon 25 May whose access has not ended, divided by those students times the lessons that count. The number is the newest snapshot; the line, on the same 14 days as the others, starts on the day of the switch to the new course. Founders and admins rebuild today's with Sync Whop and rebuild." }), children: !tile.ok ? (_jsx(Failed, {})) : tile.value.kind === "none" ? (_jsxs("p", { style: { marginTop: 12, fontSize: 13, lineHeight: 1.45, color: "var(--color-text-secondary)" }, children: ["No snapshot since the switch, ", pointDay(tile.value.since), ", yet"] })) : (_jsxs(_Fragment, { children: [_jsx(TrendNumber, { children: pct1(tile.value.value) }), _jsx(DeltaLine, { delta: deltaOf(tile.value.line), upIsGood: true, decimals: 2, unit: ["pt", "pts"] })] })) }));
}
// ── Loading ─────────────────────────────────────────────────────────────────
function Bar({ w, h = 10, mt = 0 }) {
    return (_jsx("div", { className: "animate-pulse", style: { width: w, height: h, marginTop: mt, borderRadius: 6, background: "var(--color-fill-secondary)" } }));
}
/** The page's shape in grey while it loads: the kit's skeletons, never a spinner. */
export function DashboardSkeleton() {
    return (_jsxs("div", { children: [_jsx("p", { role: "status", className: "sr-only", children: "Loading the dashboard" }), _jsxs("div", { "aria-hidden": "true", children: [_jsxs("div", { children: [_jsx(Bar, { w: "64px", h: 11 }), _jsx("div", { className: "grid grid-cols-2", style: { gap: 12, marginTop: 12 }, children: [0, 1].map((i) => (_jsx(Card, { padding: 0, children: _jsxs("div", { className: "p-4 sm:p-5", children: [_jsx(Bar, { w: "45%", h: 11 }), _jsx(Bar, { w: "28%", h: 40, mt: 14 }), _jsx(Bar, { w: "60%", mt: 14 })] }) }, i))) })] }), _jsxs("div", { style: { marginTop: SECTION_GAP }, children: [_jsx(Bar, { w: "120px", h: 11 }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4", style: { gap: 16, marginTop: 12 }, children: [0, 1, 2].map((i) => (_jsx("div", { className: i === 0 ? "flex md:col-span-2" : "flex", style: { minWidth: 0 }, children: _jsxs(HeroCard, { children: [_jsx(Bar, { w: "38%", h: 11 }), _jsx(Bar, { w: "30%", h: 48, mt: 18 }), _jsx(Bar, { w: "55%", mt: 14 }), i < 2 && _jsx(Bar, { w: "100%", h: MONTH2_CHART, mt: 32 })] }) }, i))) })] }), _jsxs("div", { style: { marginTop: SECTION_GAP }, children: [_jsx(Bar, { w: "160px", h: 11 }), _jsx("div", { className: "grid grid-cols-2 lg:grid-cols-4", style: { gap: 12, marginTop: 12 }, children: [0, 1, 2, 3].map((i) => (_jsx(Card, { padding: 0, children: _jsxs("div", { className: "p-4", children: [_jsx(Bar, { w: "55%", h: 11 }), _jsx(Bar, { w: "40%", h: 28, mt: 14 }), _jsx(Bar, { w: "70%", mt: 12 }), _jsx(Bar, { w: "100%", h: TREND_CHART, mt: 24 })] }) }, i))) })] })] })] }));
}
