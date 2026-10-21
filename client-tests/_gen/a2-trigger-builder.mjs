"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Plain-English condition builder for custom CSM templates.
 *
 * The builder is intentionally jargon-light:
 *   - "When ALL of these are true:" header
 *   - Each row: [Metric ▼] [Sub-param ▼ if applicable] [Op ▼] [Value]
 *   - Operators are phrases ("is at least", "is more than", "is not"),
 *     never raw symbols. Karlo doesn't program; this should read like
 *     a sentence.
 *   - Boolean metrics ("Region 1 is complete") collapse the value
 *     input into the operator: one select, "is yes" / "is no" (admin
 *     rebuild 2, the review's fix round: "is" alone read half-built).
 *   - Live preview at the bottom shows the rendered sentence.
 *
 * The component is fully controlled: parent owns the TriggerConfig
 * state and passes it down. The builder only emits onChange events.
 *
 * The areas and the action lessons it offers come from the live catalog
 * (`regions`, `lessons where requires_action`), so the editor offers r1..r4
 * before the course switch and a1..a8 after it. Once the switch has run
 * (admin_config.curriculum_reset_at), the three metrics that measure pace
 * against the old 30-day clock are not offered: on the new course they
 * never match (cutover PRD, C5).
 *
 * The page reads that catalog once and hands it in (admin rebuild 2, WI-8:
 * readTriggerCatalog in src/lib/admin/templates-data.ts). This component
 * used to read it itself, once for every open row, which also made the dev
 * page /dev/admin/templates reach for the database.
 *
 * Its controls are the brand kit's: 44px tall, 16px text (a phone's browser
 * zooms into a smaller field), the 12px control radius.
 */
import { METRICS, REGION_LABEL } from "./csm-triggers.ts";
const NUMERIC_OPS = [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "at_least", label: "is at least" },
    { value: "more_than", label: "is more than" },
    { value: "at_most", label: "is at most" },
    { value: "less_than", label: "is less than" },
];
/** An enum's operator: "is" / "is not", before its value. */
const BINARY_OPS = [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
];
/** A yes-or-no metric's one select: the operator and the value in one. */
const BOOLEAN_OPS = [
    { value: "is", label: "is yes" },
    { value: "is_not", label: "is no" },
];
/** The metrics that measure pace against the old course's 30-day clock. */
const CLOCK_METRICS = new Set([
    "progress_ratio",
    "progress_label",
    "region_pace",
]);
/**
 * The options for one dropdown, with the condition's current value kept
 * in the list even when the catalog no longer has it (a template written
 * for the old course), so the select never shows a different value from
 * the one saved.
 */
function withCurrent(options, current, loaded) {
    if (options.some((o) => o.id === current))
        return options;
    // An old area keeps its old label; a lesson id stands for itself.
    const label = REGION_LABEL[current] ?? current;
    return [
        { id: current, label: loaded ? `${label} (not in the course)` : label },
        ...options,
    ];
}
export function TriggerBuilder({ value, onChange, disabled, catalog: read }) {
    const conds = value.all ?? [];
    const { catalog, error } = read;
    const updateRow = (idx, next) => {
        onChange({ all: conds.map((c, i) => (i === idx ? next : c)) });
    };
    const removeRow = (idx) => {
        onChange({ all: conds.filter((_, i) => i !== idx) });
    };
    const addRow = () => {
        onChange({
            all: [...conds, { metric: "day_number", op: "at_least", value: 1 }],
        });
    };
    return (_jsxs("div", { style: {
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-control)",
            padding: 14,
        }, children: [_jsx("p", { style: {
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-text-secondary)",
                    marginBottom: 4,
                }, children: "When this message comes up" }), _jsxs("p", { style: {
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--color-text-secondary)",
                    marginBottom: 10,
                }, children: ["A task comes up when ", _jsx("strong", { style: { color: "var(--color-text-primary)" }, children: "all" }), " of these are true. For either-or cases, make one template for each."] }), error && (_jsxs("p", { role: "alert", style: {
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--color-text-primary)",
                    marginBottom: 10,
                }, children: ["The areas and lessons could not be loaded, so their dropdowns are off: ", error] })), conds.length === 0 && (_jsx("p", { style: {
                    fontSize: 13,
                    color: "var(--color-text-secondary)",
                    padding: "8px 0",
                }, children: "No conditions yet. Add one below." })), _jsx("div", { className: "flex flex-col gap-2", children: conds.map((cond, i) => (_jsx(ConditionRow, { cond: cond, catalog: catalog, disabled: disabled, onChange: (c) => updateRow(i, c), onRemove: () => removeRow(i) }, i))) }), !disabled && (_jsx("button", { type: "button", onClick: addRow, style: { ...pillStyle(), marginTop: 10 }, children: "Add a condition" })), conds.length > 0 && (_jsxs("div", { style: {
                    marginTop: 14,
                    padding: 12,
                    borderRadius: "var(--radius-chip)",
                    background: "var(--color-bg-card)",
                    border: "1px solid var(--color-border)",
                }, children: [_jsx("p", { style: {
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--color-text-secondary)",
                            marginBottom: 4,
                        }, children: "Reads as" }), _jsxs("p", { style: {
                            fontSize: 13,
                            color: "var(--color-text-primary)",
                            lineHeight: 1.55,
                        }, children: ["Comes up when", " ", conds.map((c, i) => {
                                const def = METRICS[c.metric];
                                const text = def.describe(c);
                                return (_jsxs("span", { children: [i > 0 && (_jsxs("span", { style: {
                                                color: "var(--color-accent-dark)",
                                                fontWeight: 600,
                                            }, children: [" ", "and", " "] })), text] }, i));
                            }), "."] })] }))] }));
}
function ConditionRow({ cond, catalog, disabled, onChange, onRemove, }) {
    const def = METRICS[cond.metric];
    const inputType = def.input;
    // The first area and the first action lesson of the live catalog are the
    // defaults; without the catalog, metrics that need one cannot be picked.
    const firstRegion = catalog?.regions[0]?.id ?? null;
    const firstLesson = catalog?.actionLessons[0]?.id ?? null;
    const metricOptions = Object.keys(METRICS).filter((m) => m === cond.metric ||
        (!(catalog?.courseIsNew && CLOCK_METRICS.has(m)) &&
            !(METRICS[m].param === "region" && !firstRegion) &&
            !(METRICS[m].param === "lesson" && !firstLesson)));
    // Change metric: reset to a sensible default for the new shape.
    const handleMetricChange = (newId) => {
        const newDef = METRICS[newId];
        if (newDef.input === "boolean") {
            if (newDef.param === "region") {
                onChange({ metric: newId, region: firstRegion, op: "is" });
            }
            else if (newDef.param === "lesson") {
                onChange({
                    metric: newId,
                    lesson_id: firstLesson,
                    op: "is",
                });
            }
            else {
                // Plain boolean (no param): has_logged_into_app and similar.
                onChange({ metric: newId, op: "is" });
            }
        }
        else if (newDef.input === "enum") {
            onChange({
                metric: newId,
                op: "is",
                value: newDef.enumValues?.[0] ?? "active",
            });
        }
        else {
            // numeric
            if (newDef.param === "region") {
                onChange({
                    metric: newId,
                    region: firstRegion,
                    op: "at_least",
                    value: 0,
                });
            }
            else {
                onChange({ metric: newId, op: "at_least", value: 0 });
            }
        }
    };
    return (_jsxs("div", { className: "flex flex-wrap items-center gap-2", style: {
            padding: 8,
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-chip)",
        }, children: [_jsx("select", { disabled: disabled, value: cond.metric, onChange: (e) => handleMetricChange(e.target.value), style: selectStyle(), children: metricOptions.map((m) => (_jsx("option", { value: m, children: catalog?.courseIsNew && CLOCK_METRICS.has(m)
                        ? `${METRICS[m].label} (never matches on the new course)`
                        : METRICS[m].label }, m))) }), def.param === "region" && "region" in cond && (_jsx("select", { disabled: disabled || !catalog, value: cond.region, onChange: (e) => onChange({ ...cond, region: e.target.value }), style: selectStyle(), children: withCurrent(catalog?.regions ?? [], cond.region, catalog != null).map((r) => (_jsx("option", { value: r.id, children: r.label }, r.id))) })), def.param === "lesson" && "lesson_id" in cond && (_jsx("select", { disabled: disabled || !catalog, value: cond.lesson_id, onChange: (e) => onChange({ ...cond, lesson_id: e.target.value }), style: selectStyle(), children: withCurrent(catalog?.actionLessons ?? [], cond.lesson_id, catalog != null).map((l) => (_jsx("option", { value: l.id, children: l.label }, l.id))) })), _jsx("select", { disabled: disabled, value: cond.op, onChange: (e) => onChange({ ...cond, op: e.target.value }), style: selectStyle(), children: (inputType === "number" ? NUMERIC_OPS : inputType === "boolean" ? BOOLEAN_OPS : BINARY_OPS).map((o) => (_jsx("option", { value: o.value, children: o.label }, o.value))) }), inputType === "number" && "value" in cond && typeof cond.value === "number" && (_jsx("input", { type: "number", disabled: disabled, value: cond.value, onChange: (e) => onChange({
                    ...cond,
                    value: Number(e.target.value) || 0,
                }), style: { ...selectStyle(), width: 84 } })), inputType === "number" && def.unit && (_jsx("span", { style: { fontSize: 13, color: "var(--color-text-secondary)" }, children: def.unit })), inputType === "enum" && "value" in cond && typeof cond.value === "string" && (_jsx("select", { disabled: disabled, value: cond.value, onChange: (e) => onChange({ ...cond, value: e.target.value }), style: selectStyle(), children: (def.enumValues ?? []).map((v) => (_jsx("option", { value: v, children: v }, v))) })), _jsx("div", { className: "flex-1" }), !disabled && (_jsx("button", { type: "button", onClick: onRemove, style: pillStyle(), children: "Remove" }))] }));
}
/** A dropdown or a number: 44px tall, 16px text, so a phone's browser does not zoom into it (14px with a mouse on a wide window: --admin-field-size). */
function selectStyle() {
    return {
        minHeight: 44,
        maxWidth: "100%",
        padding: "0 10px",
        fontSize: "var(--admin-field-size, 16px)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-control)",
        color: "var(--color-text-primary)",
    };
}
/** The raised pill of ui.tsx's Button (variant "raised"): 44px, a hairline. */
function pillStyle() {
    return {
        minHeight: 44,
        padding: "0 16px",
        fontSize: 13,
        fontWeight: 600,
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        cursor: "pointer",
    };
}
