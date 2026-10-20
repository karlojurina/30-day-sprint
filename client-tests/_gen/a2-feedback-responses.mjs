"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function DiscountFeedbackResponses({ responses, questions, }) {
    const byId = new Map();
    for (const r of responses)
        byId.set(r.question_id, r);
    const sortedQs = [...questions].sort((a, b) => a.order_num - b.order_num);
    const answered = sortedQs.filter((q) => byId.has(q.id));
    return (_jsx("div", { style: {
            padding: 14,
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
        }, children: answered.length === 0 ? (_jsx("p", { style: { fontSize: 13, color: "var(--color-text-secondary)" }, children: "No answer matches a question the survey has now." })) : (_jsx("dl", { className: "flex flex-col", style: { gap: 12 }, children: answered.map((q) => {
                const r = byId.get(q.id);
                let value;
                if (q.question_type === "scale" && r.answer_scale != null) {
                    value = (_jsx("strong", { style: { fontVariantNumeric: "tabular-nums", fontSize: 15 }, children: r.answer_scale }));
                }
                else if (q.question_type === "multi_choice" && r.answer_choice) {
                    value = r.answer_choice;
                }
                else if (r.answer_text && r.answer_text.trim().length > 0) {
                    value = _jsxs("span", { style: { whiteSpace: "pre-wrap" }, children: ["\u201C", r.answer_text, "\u201D"] });
                }
                else {
                    value = _jsx("span", { style: { color: "var(--color-text-secondary)" }, children: "No answer" });
                }
                return (_jsxs("div", { style: { fontSize: 13, lineHeight: 1.5 }, children: [_jsx("dt", { style: { color: "var(--color-text-secondary)", marginBottom: 2 }, children: q.question_text }), _jsx("dd", { style: { color: "var(--color-text-primary)", overflowWrap: "anywhere" }, children: value })] }, q.id));
            }) })) }));
}
