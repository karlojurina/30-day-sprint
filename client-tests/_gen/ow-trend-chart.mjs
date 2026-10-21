"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { dayLabel } from "./croatia-dates.ts";
/**
 * The Dashboard's chart (admin rebuild 2, D3): one series, as a line or as
 * daily bars, in the brand kit's one accent (Airy Blue, the colour the kit
 * names for charts) on a hairline baseline.
 *
 * No gradient and no SVG ids: the old hero chart's gradient lost its id to a
 * colour's brackets and Chrome filled the area black (cf22c36). Here the wash
 * under a line that starts at 0 is the kit's accent tint (--color-accent-glow,
 * 16% Airy Blue), flat, and every dot, bar, hairline and readout is plain HTML
 * over a path-only SVG.
 *
 *   pointer and touch  a hairline at the nearest day, its dot, and a readout
 *   keyboard           Tab to the chart, the arrows move day by day,
 *                      Home and End jump, Escape hides the readout
 *   screen reader      the readout is spoken, and a table holds every day
 *
 * A day with no reading is a gap in the line (and "No reading" in the
 * readout and the table), never a 0. A run of readings too short to read as
 * a line (SHORT_RUN) gets a dot on each reading, joined by its line, and a
 * reading alone a dot.
 *
 * Insights draws its charts with this one too (admin rebuild 2, the review's
 * fix round), with labelled gridlines (`guides`, from axisTicks in
 * src/lib/admin/insights-data.ts) in a gutter left of the plot (`gutter`),
 * so a label never covers a bar. With no gutter, a guide's label sits on its
 * line, as Month 2's 50% and 100% do.
 */
const ACCENT = "var(--color-accent-dark)";
/** Room kept free at both ends of the plot, so the end dots stay inside it. */
const INSET = 6;
/**
 * The longest run of readings (days between gaps) drawn with a dot on each
 * reading. Shorter than this, a line is a stroke a day or two long on the
 * 14 days' axis, about 20px wide, which reads as a mark rather than as
 * readings (the render review's second round: Avg progress the day after the
 * switch, 2 readings at the end of an empty chart).
 */
const SHORT_RUN = 3;
/**
 * A reading of a short run: 6px with no ring, so the line meets it. On a
 * phone the 14 days are about 10px apart: two 8px dots with their 2px rings
 * would touch there and hide the line between them.
 */
const MARK = 6;
/** "Tue 20 Oct" for a UTC date of the snapshots: noon UTC is that same date in Croatia. */
export function pointDay(date) {
    return dayLabel(`${date}T12:00:00.000Z`);
}
/** The value range drawn: a fixed one, 0 to the top for bars, or the readings' own spread, never narrower than 10% of their size. */
function range(values, kind, domain) {
    if (domain)
        return domain;
    if (kind === "bars")
        return [0, Math.max(1, ...values)];
    if (values.length === 0)
        return [0, 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A move of 6 on 1,000 stays a small move: the drawn spread is at least
    // 10% of the size of the numbers (and at least 1).
    const span = Math.max(max - min, 1, 0.1 * Math.max(Math.abs(min), Math.abs(max)));
    const mid = (min + max) / 2;
    let lo = mid - span / 2;
    let hi = mid + span / 2;
    if (min >= 0 && lo < 0) {
        hi -= lo;
        lo = 0;
    }
    return [lo, hi];
}
const dotStyle = (left, top) => ({
    position: "absolute",
    left,
    top,
    width: 8,
    height: 8,
    marginLeft: -4,
    marginTop: -4,
    borderRadius: 999,
    background: ACCENT,
    // The kit's 2px surface ring, so a dot reads where it sits on the line.
    boxShadow: "0 0 0 2px var(--color-bg-card)",
    pointerEvents: "none",
});
const markStyle = (left, top) => ({
    position: "absolute",
    left,
    top,
    width: MARK,
    height: MARK,
    marginLeft: -MARK / 2,
    marginTop: -MARK / 2,
    borderRadius: 999,
    background: ACCENT,
    pointerEvents: "none",
});
export function TrendChart({ points, kind, height, label, format, axis = false, domain, guides = [], guideFormat, gutter = 0, emptyText = "No reading", }) {
    const [active, setActive] = useState(null);
    const n = points.length;
    const emptyOf = (date) => (typeof emptyText === "function" ? emptyText(date) : emptyText);
    const values = points.map((p) => p.value).filter((v) => v !== null);
    const [lo, hi] = range(values, kind, domain);
    const padTop = kind === "bars" ? 20 : 6;
    const padBottom = kind === "bars" ? 0 : 6;
    const plotH = Math.max(1, height - padTop - padBottom);
    /** Where day i sits across the plot, 0 to 1. */
    const frac = (i) => (kind === "bars" ? (i + 0.5) / n : n === 1 ? 0.5 : i / (n - 1));
    const padL = INSET + gutter;
    const left = (i) => `calc(${padL}px + (100% - ${padL + INSET}px) * ${frac(i)})`;
    const y = (v) => padTop + (1 - (v - lo) / (hi - lo)) * plotH;
    /** The top of a bar of value v, or the line's height for v: where a guide at v is drawn. */
    const guideTop = (v) => (kind === "bars" ? height - 1 - (v / hi) * (height - padTop - 1) : y(v));
    const labelOf = guideFormat ?? format;
    let lastRead = -1;
    for (let i = n - 1; i >= 0; i--) {
        if (points[i].value !== null) {
            lastRead = i;
            break;
        }
    }
    // The line, broken at every day with no reading; and the flat wash under it
    // when the range starts at 0, so its height means something.
    const segments = [];
    if (kind === "line") {
        let cur = [];
        points.forEach((p, i) => {
            if (p.value === null) {
                if (cur.length)
                    segments.push(cur);
                cur = [];
            }
            else
                cur.push({ i, v: p.value });
        });
        if (cur.length)
            segments.push(cur);
    }
    const sx = (i) => frac(i) * 100;
    const linePath = segments
        .filter((s) => s.length > 1)
        .map((s) => s.map((p, k) => `${k === 0 ? "M" : "L"} ${sx(p.i).toFixed(3)} ${y(p.v).toFixed(2)}`).join(" "))
        .join(" ");
    const base = y(Math.max(lo, 0));
    const areaPath = lo === 0
        ? segments
            .filter((s) => s.length > 1)
            .map((s) => `M ${sx(s[0].i).toFixed(3)} ${base.toFixed(2)} ` +
            s.map((p) => `L ${sx(p.i).toFixed(3)} ${y(p.v).toFixed(2)}`).join(" ") +
            ` L ${sx(s[s.length - 1].i).toFixed(3)} ${base.toFixed(2)} Z`)
            .join(" ")
        : "";
    // A reading with no neighbour has no line to sit on: it gets its own dot. So does each reading of a run too short
    // to read as a line, joined by that line (SHORT_RUN). The last reading's ring dot is not drawn over one of them.
    const marked = segments.filter((s) => s.length <= SHORT_RUN).flat();
    const lastMarked = marked.some((p) => p.i === lastRead);
    // The tallest bar carries its value (the latest, when several tie).
    let tallest = -1;
    if (kind === "bars") {
        points.forEach((p, i) => {
            if (p.value !== null && p.value > 0 && (tallest < 0 || p.value >= (points[tallest].value ?? 0)))
                tallest = i;
        });
    }
    const readout = (i) => {
        const p = points[i];
        return `${pointDay(p.date)}: ${p.value === null ? emptyOf(p.date) : format(p.value)}`;
    };
    const nearest = (clientX, el) => {
        if (n === 0)
            return null;
        const r = el.getBoundingClientRect();
        const inner = r.width - padL - INSET;
        if (inner <= 0)
            return null;
        const rel = (clientX - r.left - padL) / inner;
        const i = kind === "bars" ? Math.floor(rel * n) : Math.round(rel * (n - 1));
        return Math.max(0, Math.min(n - 1, i));
    };
    const shown = active !== null && active < n ? active : null;
    const shownPoint = shown !== null ? points[shown] : null;
    return (_jsxs("figure", { style: { margin: 0, minWidth: 0 }, children: [_jsxs("div", { role: "group", "aria-roledescription": "chart", "aria-label": `${label}, ${n ? `${pointDay(points[0].date)} to ${pointDay(points[n - 1].date)}` : "no days"}. The arrow keys read each day.`, tabIndex: n ? 0 : -1, style: { position: "relative", height, touchAction: "pan-y", outlineOffset: 4, borderRadius: 4, cursor: n ? "crosshair" : "default" }, onPointerMove: (e) => setActive(nearest(e.clientX, e.currentTarget)), onPointerDown: (e) => setActive(nearest(e.clientX, e.currentTarget)), onPointerLeave: (e) => {
                    // A finger lifting also leaves: its readout stays until the next tap elsewhere.
                    if (e.pointerType === "mouse")
                        setActive(null);
                }, onFocus: () => setActive((a) => (a === null ? (lastRead >= 0 ? lastRead : n - 1) : a)), onBlur: () => setActive(null), onKeyDown: (e) => {
                    if (n === 0)
                        return;
                    const cur = shown ?? (lastRead >= 0 ? lastRead : n - 1);
                    let next;
                    if (e.key === "ArrowLeft")
                        next = Math.max(0, cur - 1);
                    else if (e.key === "ArrowRight")
                        next = Math.min(n - 1, cur + 1);
                    else if (e.key === "Home")
                        next = 0;
                    else if (e.key === "End")
                        next = n - 1;
                    else if (e.key === "Escape") {
                        setActive(null);
                        return;
                    }
                    else
                        return;
                    e.preventDefault();
                    setActive(next);
                }, children: [_jsx("div", { "aria-hidden": "true", style: {
                            position: "absolute",
                            left: gutter,
                            right: 0,
                            top: kind === "bars" ? height - 1 : Math.round(base),
                            height: 1,
                            background: "var(--color-border)",
                            display: kind === "bars" || lo === 0 ? "block" : "none",
                        } }), gutter === 0 &&
                        kind === "line" &&
                        guides
                            .filter((g) => g > lo && g <= hi)
                            .map((g) => (_jsx("div", { "aria-hidden": "true", style: { position: "absolute", left: 0, right: 0, top: Math.round(y(g)), height: 1, background: "var(--color-border)" }, children: _jsx("span", { style: {
                                    position: "absolute",
                                    left: 0,
                                    bottom: 3,
                                    paddingRight: 4,
                                    fontSize: 11,
                                    lineHeight: "13px",
                                    color: "var(--color-text-secondary)",
                                    background: "var(--color-bg-card)",
                                    fontVariantNumeric: "tabular-nums",
                                }, children: labelOf(g) }) }, g))), gutter > 0 &&
                        guides
                            .filter((g) => g >= lo && g <= hi)
                            .map((g) => {
                            const top = Math.round(guideTop(g));
                            const onBaseline = g === lo && (kind === "bars" || lo === 0);
                            return (_jsxs("div", { "aria-hidden": "true", "data-guide": labelOf(g), children: [!onBaseline && (_jsx("div", { style: { position: "absolute", left: gutter, right: 0, top, height: 1, background: "var(--color-border)" } })), _jsx("span", { style: {
                                            position: "absolute",
                                            left: 0,
                                            width: gutter - 6,
                                            top: top - 7,
                                            textAlign: "right",
                                            fontSize: 11,
                                            lineHeight: "14px",
                                            color: "var(--color-text-secondary)",
                                            fontVariantNumeric: "tabular-nums",
                                            whiteSpace: "nowrap",
                                        }, children: labelOf(g) })] }, g));
                        }), kind === "line" && (_jsxs("svg", { "aria-hidden": "true", viewBox: `0 0 100 ${height}`, preserveAspectRatio: "none", style: { position: "absolute", left: padL, right: INSET, top: 0, width: `calc(100% - ${padL + INSET}px)`, height, overflow: "visible" }, children: [areaPath && _jsx("path", { d: areaPath, style: { fill: "var(--color-accent-glow)", stroke: "none" } }), linePath && (_jsx("path", { d: linePath, vectorEffect: "non-scaling-stroke", style: { fill: "none", stroke: ACCENT, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } }))] })), kind === "bars" && (_jsx("div", { "aria-hidden": "true", style: { position: "absolute", left: padL, right: INSET, top: padTop, bottom: 1, display: "flex", alignItems: "flex-end", gap: 2 }, children: points.map((p, i) => (_jsxs("div", { style: { flex: "1 1 0", minWidth: 0, height: "100%", position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center" }, children: [p.value !== null && p.value > 0 && (_jsx("div", { style: {
                                        width: "100%",
                                        maxWidth: 24,
                                        height: `${(p.value / hi) * 100}%`,
                                        borderRadius: "4px 4px 0 0",
                                        background: ACCENT,
                                        opacity: shown === null || shown === i ? 1 : 0.45,
                                        transition: "opacity 150ms var(--ease-default)",
                                    } })), i === tallest && p.value !== null && (_jsx("span", { style: {
                                        position: "absolute",
                                        bottom: `calc(${(p.value / hi) * 100}% + 4px)`,
                                        left: "50%",
                                        transform: "translateX(-50%)",
                                        fontSize: 12,
                                        lineHeight: "14px",
                                        color: "var(--color-text-secondary)",
                                        fontVariantNumeric: "tabular-nums",
                                        whiteSpace: "nowrap",
                                    }, children: format(p.value) }))] }, p.date))) })), kind === "line" && marked.map((p) => _jsx("div", { "aria-hidden": "true", "data-reading-dot": "", style: markStyle(left(p.i), y(p.v)) }, p.i)), kind === "line" && lastRead >= 0 && shown === null && !lastMarked && (_jsx("div", { "aria-hidden": "true", style: dotStyle(left(lastRead), y(points[lastRead].value)) })), shown !== null && (_jsxs(_Fragment, { children: [kind === "line" && (_jsx("div", { "aria-hidden": "true", style: {
                                    position: "absolute",
                                    left: left(shown),
                                    top: 0,
                                    bottom: 0,
                                    width: 1,
                                    background: "var(--color-border-strong)",
                                    pointerEvents: "none",
                                } })), kind === "line" && shownPoint?.value != null && (_jsx("div", { "aria-hidden": "true", style: dotStyle(left(shown), y(shownPoint.value)) })), _jsxs("div", { "aria-hidden": "true", style: {
                                    position: "absolute",
                                    left: left(shown),
                                    bottom: "calc(100% + 6px)",
                                    transform: `translateX(-${frac(shown) * 100}%)`,
                                    zIndex: 3,
                                    pointerEvents: "none",
                                    whiteSpace: "nowrap",
                                    padding: "6px 10px",
                                    borderRadius: "var(--radius-chip)",
                                    background: "var(--color-bg-elevated)",
                                    border: "1px solid var(--color-border-strong)",
                                    fontSize: 12,
                                    lineHeight: "16px",
                                    color: "var(--color-text-secondary)",
                                }, children: [_jsx("strong", { style: { fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }, children: shownPoint.value === null ? emptyOf(shownPoint.date) : format(shownPoint.value) }), " ", pointDay(shownPoint.date)] })] }))] }), axis && n > 0 && (_jsxs("div", { "aria-hidden": "true", style: {
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    marginTop: 8,
                    paddingLeft: gutter,
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    fontVariantNumeric: "tabular-nums",
                }, children: [_jsx("span", { children: pointDay(points[0].date) }), n > 1 && _jsx("span", { children: pointDay(points[n - 1].date) })] })), _jsx("p", { className: "sr-only", "aria-live": "polite", children: shown !== null ? readout(shown) : "" }), _jsx("div", { className: "sr-only", children: _jsxs("table", { children: [_jsxs("caption", { children: [label, ", per day"] }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Day" }), _jsx("th", { scope: "col", children: label })] }) }), _jsx("tbody", { children: points.map((p) => (_jsxs("tr", { children: [_jsx("td", { children: pointDay(p.date) }), _jsx("td", { children: p.value === null ? emptyOf(p.date) : format(p.value) })] }, p.date))) })] }) })] }));
}
