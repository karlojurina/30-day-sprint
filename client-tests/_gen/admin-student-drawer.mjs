"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
const Link = (props) => props.children;
import { createClient } from "./stub-server.ts";
const getDayNumber = () => 1;
import { progressPercent } from "./constants.ts";
import { completedLessonIdsFor } from "./progress.ts";
import { currentStreakAsOf, getTodayUtc } from "./streak.ts";
/**
 * Right-side drawer with a student's detail. Opens from the kanban
 * cards. A condensed version of /admin/students/[id] — same data,
 * lighter chrome. Click "Open full page" to jump to the full detail.
 *
 * Slide-in animation; click backdrop or Escape to dismiss.
 *
 * Keyed by the student, so each one opens on fresh state. The journey page
 * keeps the drawer mounted, and its state used to survive from one student
 * to the next: a student with no application or no streak row showed the
 * previous student's (their status and Whop code, their streak), and a slow
 * answer for the previous student could land on the next (fix lane G1,
 * admin-2).
 */
export function StudentDrawer(props) {
    return _jsx(StudentDrawerBody, { ...props }, props.studentId ?? "");
}
function StudentDrawerBody({ studentId, onClose }) {
    const supabase = createClient();
    const [student, setStudent] = useState(null);
    const [regions, setRegions] = useState([]);
    const [lessons, setLessons] = useState([]);
    const [completions, setCompletions] = useState([]);
    const [discountRequest, setDiscountRequest] = useState(null);
    // v46 — streaks split out of students; read separately.
    const [streaks, setStreaks] = useState(null);
    const [loading, setLoading] = useState(true);
    const [savingVerification, setSavingVerification] = useState(false);
    // A fresh mount per student (above): loading is true and every value
    // empty until this student's answers land. Answers that arrive after the
    // drawer moved on are dropped.
    useEffect(() => {
        if (!studentId)
            return;
        let cancelled = false;
        async function fetchAll() {
            const [studentRes, regionsRes, lessonsRes, completionsRes, discountRes, streaksRes,] = await Promise.all([
                supabase.from("students").select("*").eq("id", studentId).single(),
                supabase.from("regions").select("*").order("order_num"),
                supabase.from("lessons").select("*").order("day").order("sort_order"),
                supabase
                    .from("student_lesson_completions")
                    .select("*")
                    .eq("student_id", studentId),
                supabase
                    .from("discount_requests")
                    .select("*")
                    .eq("student_id", studentId)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .single(),
                supabase
                    .from("student_streaks")
                    .select("*")
                    .eq("student_id", studentId)
                    .maybeSingle(),
            ]);
            if (cancelled)
                return;
            // This student's values come from this student's answers, every
            // time: no row (no application, no streak yet) reads as none.
            setStudent(studentRes.data ?? null);
            if (regionsRes.data)
                setRegions(regionsRes.data);
            if (lessonsRes.data)
                setLessons(lessonsRes.data);
            setCompletions(completionsRes.data ?? []);
            setDiscountRequest(discountRes.data ?? null);
            setStreaks(streaksRes.data ?? null);
            setLoading(false);
        }
        fetchAll();
        return () => {
            cancelled = true;
        };
    }, [studentId, supabase]);
    // Escape closes
    useEffect(() => {
        if (!studentId)
            return;
        const onKey = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [studentId, onClose]);
    // Canonical "lesson is complete" check — see src/lib/progress.ts.
    // Was previously `completions.filter((c) => c.completed_at)` which
    // missed compound-lesson requirements + skipped lessons.
    const completedIds = useMemo(() => completedLessonIdsFor(completions, lessons), [completions, lessons]);
    // Over the lessons that count toward progress, as every other admin
    // surface counts them (the old course's 64, the new course's 140); a
    // lesson that does not count (l057, the pond row) is left out of both
    // sides. Null when the lessons could not be read: the stat shows "—".
    const countingLessons = lessons.filter((l) => l.counts_toward_progress !== false);
    const countingDone = countingLessons.filter((l) => completedIds.has(l.id)).length;
    const overallPercent = countingLessons.length > 0
        ? progressPercent(countingDone, countingLessons.length)
        : null;
    // v75.18: anchor day on first_paid_at (original signup).
    const dayNumber = student
        ? getDayNumber(student.first_paid_at ?? student.joined_at)
        : 1;
    async function toggleAdSubmissionsVerified(verified) {
        if (!student)
            return;
        const prev = student.ad_submissions_verified;
        setStudent({ ...student, ad_submissions_verified: verified });
        setSavingVerification(true);
        const { data: { session }, } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
            setSavingVerification(false);
            return;
        }
        const res = await fetch("/api/admin/verify-ad-submissions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ studentId: student.id, verified }),
        });
        if (!res.ok) {
            // Revert on failure
            setStudent({ ...student, ad_submissions_verified: prev });
        }
        setSavingVerification(false);
    }
    if (!studentId)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: onClose, "aria-label": "Close drawer", className: "fixed inset-0 z-40", style: {
                    background: "rgba(20, 20, 24, 0.30)",
                    backdropFilter: "blur(2px)",
                    animation: "overlay-in 0.25s var(--ease-default) both",
                    border: "none",
                    padding: 0,
                } }), _jsx("aside", { role: "dialog", "aria-modal": "true", "aria-labelledby": "drawer-student-name", className: "fixed top-0 right-0 h-screen z-50 overflow-y-auto", style: {
                    width: "min(520px, 92vw)",
                    background: "var(--color-bg-secondary)",
                    borderLeft: "1px solid var(--color-border)",
                    boxShadow: "-24px 0 64px rgba(20,20,24,0.18), -2px 0 8px rgba(20,20,24,0.06)",
                    animation: "slide-in-right 0.32s var(--ease-default) both",
                }, children: loading || !student ? (_jsx("div", { className: "flex items-center justify-center h-full", children: _jsx("div", { className: "rounded-full animate-spin", style: {
                            width: 22,
                            height: 22,
                            border: "2px solid var(--color-accent)",
                            borderTopColor: "transparent",
                        } }) })) : (_jsxs("div", { style: { padding: 24 }, children: [_jsxs("div", { className: "flex items-start justify-between", style: { gap: 12, marginBottom: 24 }, children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { id: "drawer-student-name", className: "truncate", style: {
                                                fontSize: 20,
                                                fontWeight: 600,
                                                color: "var(--color-text-primary)",
                                                letterSpacing: "-0.019em",
                                            }, children: student.name || "Unnamed student" }), _jsxs("p", { className: "truncate", style: {
                                                fontSize: 13,
                                                color: "var(--color-text-secondary)",
                                                marginTop: 2,
                                                letterSpacing: "-0.005em",
                                            }, children: [student.email, " \u00B7 Day ", dayNumber, " \u00B7 ", student.membership_status] })] }), _jsx("button", { onClick: onClose, "aria-label": "Close drawer", style: {
                                        width: 28,
                                        height: 28,
                                        borderRadius: 8,
                                        background: "var(--color-bg-elevated)",
                                        border: "none",
                                        color: "var(--color-text-tertiary)",
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                    }, children: _jsx("svg", { width: "14", height: "14", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M6 18L18 6M6 6l12 12" }) }) })] }), _jsxs("div", { className: "grid grid-cols-2", style: { gap: 8, marginBottom: 24 }, children: [_jsx(Stat, { label: "Progress", value: overallPercent == null ? "—" : `${overallPercent}%`, accent: true }), _jsx(Stat, { label: "Streak", value: `${currentStreakAsOf(streaks, getTodayUtc())}d` }), _jsx(Stat, { label: "Joined", value: new Date(student.joined_at).toLocaleDateString() }), _jsx(Stat, { label: "Last active", value: new Date(student.last_active_at).toLocaleDateString() })] }), _jsxs("section", { style: { marginBottom: 24 }, children: [_jsx("p", { className: "section-label", style: { marginBottom: 10 }, children: "Lessons by region" }), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: regions.map((r) => {
                                        // Counting lessons only, like the total above: a lesson
                                        // outside progress would leave the area at 14/15 forever.
                                        const regionLessons = countingLessons.filter((l) => l.region_id === r.id);
                                        const total = regionLessons.length;
                                        const done = regionLessons.filter((l) => completedIds.has(l.id)).length;
                                        const pct = total ? Math.round((done / total) * 100) : 0;
                                        return (_jsxs("div", { className: "flex items-center", style: { gap: 12 }, children: [_jsx("span", { className: "truncate", style: {
                                                        fontSize: 13,
                                                        color: "var(--color-text-secondary)",
                                                        width: 120,
                                                        letterSpacing: "-0.005em",
                                                    }, children: r.name }), _jsx("div", { className: "flex-1 overflow-hidden", style: {
                                                        height: 4,
                                                        borderRadius: 2,
                                                        background: "var(--color-fill-secondary, rgba(20,20,24,0.06))",
                                                    }, children: _jsx("div", { style: {
                                                            height: "100%",
                                                            width: `${pct}%`,
                                                            background: "var(--color-accent)",
                                                            transition: "width 250ms var(--ease-default)",
                                                        } }) }), _jsxs("span", { style: {
                                                        fontSize: 12,
                                                        color: "var(--color-text-tertiary)",
                                                        fontVariantNumeric: "tabular-nums",
                                                        width: 48,
                                                        textAlign: "right",
                                                    }, children: [done, "/", total] })] }, r.id));
                                    }) })] }), _jsx(ActionSubmissionsSection, { lessons: lessons, completions: completions }), _jsxs("section", { className: "surface-resting", style: {
                                background: "var(--color-bg-card)",
                                borderRadius: 12,
                                padding: 16,
                                marginBottom: 24,
                            }, children: [_jsx("p", { className: "section-label", style: { marginBottom: 8 }, children: "Discount" }), _jsx("p", { style: {
                                        fontSize: 13,
                                        color: "var(--color-text-secondary)",
                                        marginBottom: 14,
                                        letterSpacing: "-0.005em",
                                    }, children: discountRequest
                                        ? `Application: ${discountRequest.status}${discountRequest.promo_code ? ` · ${discountRequest.promo_code}` : ""}`
                                        : "No application submitted" }), _jsxs("label", { className: "flex items-start cursor-pointer", style: { gap: 10 }, children: [_jsx("input", { type: "checkbox", checked: student.ad_submissions_verified ?? false, disabled: savingVerification, onChange: (e) => toggleAdSubmissionsVerified(e.target.checked), className: "rounded accent-[var(--color-accent)]", style: { marginTop: 2 } }), _jsxs("span", { style: { fontSize: 13 }, children: [_jsx("span", { style: {
                                                        display: "block",
                                                        fontWeight: 500,
                                                        color: "var(--color-text-primary)",
                                                        letterSpacing: "-0.005em",
                                                    }, children: "Ad submissions verified" }), _jsx("span", { style: {
                                                        color: "var(--color-text-tertiary)",
                                                        fontSize: 12,
                                                    }, children: "Required before discount approval. Tick after confirming submissions in Discord." })] })] })] }), _jsx("div", { style: {
                                paddingTop: 16,
                                borderTop: "1px solid var(--color-border)",
                            }, children: _jsxs(Link, { href: `/admin/students/${student.id}`, className: "inline-flex items-center", style: {
                                    gap: 6,
                                    fontSize: 13,
                                    color: "var(--color-accent-dark)",
                                    textDecoration: "none",
                                    letterSpacing: "-0.005em",
                                }, children: ["Open full detail page", _jsx("svg", { width: "13", height: "13", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M14 5l7 7m0 0l-7 7m7-7H3" }) })] }) })] })) })] }));
}
function Stat({ label, value, accent = false, }) {
    return (_jsxs("div", { className: "surface-resting", style: {
            background: "var(--color-bg-card)",
            borderRadius: 10,
            padding: 12,
        }, children: [_jsx("p", { style: {
                    fontSize: 10,
                    fontWeight: 500,
                    color: "var(--color-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                }, children: label }), _jsx("p", { style: {
                    fontSize: 18,
                    fontWeight: 600,
                    color: accent
                        ? "var(--color-accent-dark)"
                        : "var(--color-text-primary)",
                    marginTop: 4,
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.018em",
                    lineHeight: 1.05,
                }, children: value })] }));
}
/**
 * Shows every action-item lesson the student has interacted with,
 * the ship state, and the Discord message link they pasted on each
 * (if any). Astrid uses this to verify submissions inline before
 * ticking ad_submissions_verified.
 */
function ActionSubmissionsSection({ lessons, completions, }) {
    const actionLessons = useMemo(() => lessons
        .filter((l) => l.requires_action || l.type === "action")
        .sort((a, b) => a.day - b.day || a.sort_order - b.sort_order), [lessons]);
    const compById = useMemo(() => {
        const m = new Map();
        for (const c of completions)
            m.set(c.lesson_id, c);
        return m;
    }, [completions]);
    if (actionLessons.length === 0)
        return null;
    return (_jsxs("section", { className: "surface-resting", style: {
            background: "var(--color-bg-card)",
            borderRadius: 12,
            padding: 16,
            marginBottom: 24,
        }, children: [_jsx("p", { className: "section-label", style: { marginBottom: 10 }, children: "Action-item submissions" }), _jsx("div", { className: "flex flex-col gap-2", children: actionLessons.map((lesson) => {
                    const c = compById.get(lesson.id);
                    const shipped = Boolean(c?.action_completed_at) || Boolean(c?.completed_at && lesson.type === "action");
                    const link = c?.discord_message_link ?? null;
                    return (_jsxs("div", { className: "flex items-center gap-2", style: { fontSize: 12.5 }, children: [_jsx("span", { style: {
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                    color: "var(--color-text-tertiary)",
                                    minWidth: 36,
                                }, children: lesson.id }), _jsx("span", { style: {
                                    flex: 1,
                                    color: shipped
                                        ? "var(--color-text-primary)"
                                        : "var(--color-text-tertiary)",
                                }, children: lesson.title }), _jsx("span", { style: {
                                    fontSize: 11,
                                    color: shipped
                                        ? "var(--color-accent-dark)"
                                        : "var(--color-text-tertiary)",
                                    fontWeight: shipped ? 600 : 400,
                                    minWidth: 64,
                                    textAlign: "right",
                                }, children: shipped ? "shipped" : "—" }), link ? (_jsx("a", { href: link, target: "_blank", rel: "noopener noreferrer", style: {
                                    fontSize: 11,
                                    padding: "3px 8px",
                                    borderRadius: 4,
                                    background: "rgba(88,101,242,0.12)",
                                    color: "#7d8be8",
                                    textDecoration: "none",
                                    fontWeight: 600,
                                }, title: link, children: "\uD83D\uDD17 Discord" })) : shipped ? (_jsx("span", { style: {
                                    fontSize: 11,
                                    color: "var(--color-text-tertiary)",
                                    fontStyle: "italic",
                                }, children: "no link" })) : (_jsx("span", { style: { width: 64 } }))] }, lesson.id));
                }) })] }));
}
