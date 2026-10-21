"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, Card, Pill, Section, T } from "./rf-ui.mjs";
import { ListHeader, ListPage, SkeletonRows } from "./rf-list-parts.mjs";
export function CutoverView({ status, error, loading, checkedAt, onCheck, }) {
    return (_jsxs(ListPage, { children: [_jsx(ListHeader, { title: "Course switch", description: "What the running build and the database hold right now. Look again after every redeploy.", meta: checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}` : undefined, action: _jsx(Button, { variant: "raised", size: "md", onClick: onCheck, busy: loading, children: "Check again" }) }), loading && !status && !error ? (_jsx(SkeletonRows, { rows: 3, label: "Checking the course switch" })) : error ? (_jsxs(Card, { padding: 20, style: { borderLeft: "3px solid var(--color-danger)" }, children: [_jsxs("p", { role: "alert", style: { ...T.cardTitle, display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("span", { "aria-hidden": "true", style: { flex: "none", width: 8, height: 8, borderRadius: 999, background: "var(--color-danger)" } }), "The status could not be checked"] }), _jsx("p", { style: { ...T.bodyDim, marginTop: 6, overflowWrap: "anywhere" }, children: error })] })) : status ? (_jsx(StatusView, { status: status })) : null] }));
}
function StatusView({ status }) {
    const { build, db } = status;
    return (_jsxs(_Fragment, { children: [_jsx(Section, { children: _jsxs(Card, { padding: 20, style: {
                        borderLeft: `3px solid ${status.ok ? "var(--color-success)" : "var(--color-danger)"}`,
                    }, children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("p", { style: T.heading, children: status.ok ? "All good" : problemCount(status.problems.length) }), _jsx(Pill, { tone: status.phase === "after" ? "accent" : "neutral", children: status.phase === "after"
                                        ? "After the switch"
                                        : "Before the switch" })] }), status.ok ? (_jsx("p", { style: { ...T.bodyDim, marginTop: 6 }, children: status.phase === "after"
                                ? "The build and the database agree on the new course. The Whop course is not checked here (below)."
                                : "The old course is live. The values the switch needs are checked once it has run. The Whop course is not checked here (below)." })) : (_jsx("ul", { style: { marginTop: 10, paddingLeft: 18, listStyle: "disc" }, children: status.problems.map((p) => (_jsx("li", { style: { ...T.body, marginTop: 4 }, children: p }, p))) }))] }) }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2", style: { gap: 16 }, children: [_jsx(Section, { eyebrow: "Running build", children: _jsxs(Card, { padding: 0, children: [_jsx(FactRow, { label: "Student home", value: build.studentHome }), _jsx(FactRow, { label: "World open to everyone", value: build.worldLive ? "Yes" : "No" }), _jsx(FactRow, { label: "Catalog shape", value: build.catalogIsV2 ? "v2 (the new course)" : "v1 (the old course)" }), _jsx(FactRow, { label: "Catalog table", value: build.tableSuffix
                                        ? `${build.catalogTable} (CATALOG_TABLE_SUFFIX is ${build.tableSuffix})`
                                        : build.catalogTable }), _jsx(FactRow, { label: "Whop course", value: !build.whopCourseIdSet
                                        ? "Not set"
                                        : build.whopCourseIdTail
                                            ? `Set, ends in ${build.whopCourseIdTail}`
                                            : "Set" }), _jsx(FactRow, { label: "Deployment", value: build.deploymentId || build.commit
                                        ? [build.deploymentId, build.commit && `commit ${build.commit}`]
                                            .filter(Boolean)
                                            .join(" · ")
                                        : "Not reported", last: true })] }) }), _jsx(Section, { eyebrow: "Database", children: _jsxs(Card, { padding: 0, children: [_jsx(FactRow, { label: "Course switch", value: db.resetAt
                                        ? `Ran ${new Date(db.resetAt).toLocaleString()}`
                                        : "Not run" }), _jsx(FactRow, { label: "Areas", value: db.regionIds.length > 0
                                        ? `${db.regionIds.length}: ${db.regionIds.join(", ")}`
                                        : "None" }), _jsx(FactRow, { label: "Lessons", value: String(db.lessons) }), _jsx(FactRow, { label: "Counting toward progress", value: String(db.countingLessons) }), _jsx(FactRow, { label: "With a Whop lesson id", value: `${db.lessonsWithWhopId} of ${db.lessons}`, last: true })] }) })] }), _jsx(WhopCourseNotChecked, { phase: status.phase, lessons: db.lessons })] }));
}
/**
 * Which course WHOP_COURSE_ID names is not checked: the route makes no
 * Whop call. The check it needs is written in the route's header. A
 * wrong course fails with no error anywhere (the backfill matches 0 and
 * writes no error), so "All good" must not read as covering it.
 */
function WhopCourseNotChecked({ phase, lessons, }) {
    return (_jsx(Section, { eyebrow: "Not checked here", children: _jsxs(Card, { padding: 20, children: [_jsx("p", { style: T.cardTitle, children: "Which course the Whop course id names" }), _jsx("p", { style: { ...T.bodyDim, marginTop: 6 }, children: "This page makes no call to Whop, so it cannot tell which course WHOP_COURSE_ID is. Checking it means reading that course's lessons from Whop and finding their ids in the lessons table." }), _jsx("p", { style: { ...T.body, marginTop: 10 }, children: phase === "before"
                        ? "Before the switch, production's value must still be the old course: the old dashboard's Whop sync reads it."
                        : `After the switch its lessons should be the same ${lessons} as the lessons table. Until this page checks it, finish one lesson on Whop and see it lit on /world.` })] }) }));
}
function problemCount(n) {
    return n === 1 ? "1 problem" : `${n} problems`;
}
function FactRow({ label, value, last = false, }) {
    return (_jsxs("div", { className: "flex items-baseline justify-between", style: {
            gap: 16,
            padding: "12px 16px",
            borderBottom: last ? "none" : "1px solid var(--color-border)",
        }, children: [_jsx("span", { style: T.bodyDim, children: label }), _jsx("span", { style: {
                    ...T.body,
                    fontWeight: 500,
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                    overflowWrap: "anywhere",
                }, children: value })] }));
}
