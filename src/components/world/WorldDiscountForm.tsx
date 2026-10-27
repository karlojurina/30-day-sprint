"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import tokens from "@/components/world-v6/tokens.module.css";
import { defaultValue, isAnswered, toAnswers, type AnswerValue } from "@/lib/discount-feedback";
import { DISCOUNT_PERCENT } from "@/lib/world/discount";
import type { DiscountFeedbackQuestion } from "@/types/database";
import type { DiscountFormState } from "./useWorldDiscount";
import f from "./discount-form.module.css";

/**
 * The discount application's questions, on the map (2026-10-14).
 *
 * The old dashboard sent every application through its 6-question form
 * (src/components/map/DiscountFeedbackModal.tsx) and the team reads the
 * answers; the map's Apply opens this one with the same questions and sends
 * them the same way (useWorldDiscount.ts holds whether it is open, the
 * questions and the submit). The rules of an answer are both forms'
 * (src/lib/discount-feedback.ts): one question at a time, a required one must
 * be answered to go on, the optional ones say so.
 *
 * It takes the checkpoint panel's slot (discount-form.module.css), so the
 * panel seems to turn into it, the cache still in view; on phones it is a
 * full sheet. Esc and Cancel close it and leave the checkpoint open under it,
 * with nothing sent; a click on the world beside it does the same. While it
 * sends, neither does. Sent, it closes, and the checkpoint's panel shows the
 * request as it stands, "The discount has been approved." once the 30% went
 * on in the same request (T-137), else in review: that is the confirmation,
 * so there is no screen of its own.
 * Refused, it stays on the last question with the answers kept and says why.
 *
 * WorldMap.tsx mounts it beside the map. Under a lesson page (`paused`) it is
 * not shown.
 */
export function WorldDiscountForm({ form, paused }: { form: DiscountFormState; paused: boolean }) {
  if (!form.open || paused || form.questions.length === 0) return null;
  // Mounted on each open, so every application starts on the first question.
  return <FormBody form={form} />;
}

function FormBody({ form }: { form: DiscountFormState }) {
  const { questions, close, submit } = form;
  const total = questions.length;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, defaultValue(q)])),
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read once, when it opens, as the corner's list does: the map's list view
  // (phones) gets the full sheet.
  const [sheet] = useState(() => document.querySelector("main[data-view]")?.getAttribute("data-view") === "list");
  // Where focus goes back to: Apply, unless sending took it off the page.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  const panelRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef(false);
  const alive = useRef(true);
  const titleId = useId();
  const questionId = useId();

  const at = Math.min(step, total - 1);
  const q = questions[at];
  const value = answers[q.id] ?? defaultValue(q);
  const canGoOn = isAnswered(q, value);
  const last = at === total - 1;

  // Each question: the keyboard starts on its words, or in the box to type in.
  useEffect(() => {
    if (q.question_type === "open_text") textRef.current?.focus({ preventScroll: true });
    else headingRef.current?.focus({ preventScroll: true });
  }, [at, q.question_type]);

  // Esc closes (before the map's own Esc, which would close the checkpoint
  // under it). Tab goes round inside the form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!sendingRef.current) close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const stops = tabStops(panelRef.current);
      if (stops.length === 0) return;
      const now = document.activeElement;
      const i = now instanceof HTMLElement ? stops.indexOf(now) : -1;
      const inside = now instanceof Node && panelRef.current.contains(now);
      if (e.shiftKey && (i === 0 || !inside || (i === -1 && now === headingRef.current))) {
        e.preventDefault();
        stops[stops.length - 1].focus({ preventScroll: true });
      } else if (!e.shiftKey && (i === stops.length - 1 || !inside)) {
        e.preventDefault();
        stops[0].focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  // Closed: focus back to what opened it, when that is still on the page.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  const setValue = (next: AnswerValue) => setAnswers((prev) => ({ ...prev, [q.id]: next }));

  // Not a `finally`: the React compiler gives up on a component that has one
  // (LessonPlayer.tsx says the same).
  const send = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    let said: string | null;
    try {
      said = await submit(toAnswers(questions, answers));
    } catch {
      said = "That didn't go through. Try again in a moment.";
    }
    sendingRef.current = false;
    // Sent: the hook closed the form, and this is gone.
    if (!alive.current) return;
    setSending(false);
    setError(said);
  };

  const goOn = () => {
    if (!canGoOn || sending) return;
    if (last) void send();
    else {
      setError(null);
      setStep(at + 1);
    }
  };

  const cancel = () => {
    if (!sendingRef.current) close();
  };

  return (
    <div className={`${tokens.tokens} ${f.root}`} data-sheet={sheet || undefined} data-discount-form="">
      {/* A click on the world beside the form closes it, as Cancel does. */}
      <div className={f.scrim} aria-hidden="true" onClick={cancel} />
      <section
        ref={panelRef}
        className={f.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={sending || undefined}
      >
        <div className={f.inner}>
          <div className={f.top}>
            <p id={titleId} className={f.eyebrow}>
              <TagGlyph />
              Apply for {DISCOUNT_PERCENT}% off
            </p>
            <span className={f.count} aria-hidden="true">
              <b>{at + 1}</b> of {total}
            </span>
          </div>
          <div className={f.bar} aria-hidden="true">
            <i style={{ transform: `scaleX(${(at + 1) / total})` }} />
          </div>

          <div key={q.id} className={f.step}>
            <h2 ref={headingRef} id={questionId} tabIndex={-1} className={f.question}>
              <span className={f.srOnly}>
                Question {at + 1} of {total}.{" "}
              </span>
              {q.question_text}
              {!q.is_required && <span className={f.optional}>Optional</span>}
            </h2>
            <div className={f.answer}>
              <Answer question={q} value={value} labelId={questionId} textRef={textRef} onChange={setValue} />
            </div>
          </div>

          {error && (
            <p className={f.error} role="alert">
              {error}
            </p>
          )}

          <div className={f.foot}>
            <button type="button" className={f.cancel} onClick={cancel} disabled={sending}>
              Cancel
            </button>
            {at > 0 && (
              <button
                type="button"
                className={f.back}
                disabled={sending}
                onClick={() => {
                  setError(null);
                  setStep(at - 1);
                }}
              >
                <Arrow />
                Back
              </button>
            )}
            <button
              type="button"
              className={f.primary}
              onClick={goOn}
              disabled={!canGoOn || (sending && !last)}
              aria-busy={sending || undefined}
            >
              {last ? (sending ? "Sending…" : "Send application") : "Next"}
              {!sending && <Arrow className={f.arrow} />}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** The question's answer: a row of numbers, a list of choices, or a box to type in. */
function Answer({
  question: q,
  value,
  labelId,
  textRef,
  onChange,
}: {
  question: DiscountFeedbackQuestion;
  value: AnswerValue;
  labelId: string;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (next: AnswerValue) => void;
}) {
  if (q.question_type === "scale") {
    const min = q.scale_min ?? 1;
    const max = q.scale_max ?? 10;
    const cur = value.kind === "scale" ? value.value : null;
    const options = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
    return (
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={f.scale}
        style={{ "--n": Math.min(options.length, 10) } as CSSProperties}
      >
        {options.map((n) => (
          <label key={n} className={f.scaleItem}>
            <input
              type="radio"
              className={f.radio}
              name={q.id}
              value={n}
              checked={cur === n}
              onChange={() => onChange({ kind: "scale", value: n })}
            />
            {n}
          </label>
        ))}
      </div>
    );
  }
  if (q.question_type === "multi_choice") {
    const options = Array.isArray(q.options) ? q.options : [];
    const cur = value.kind === "choice" ? value.value : null;
    return (
      <div role="radiogroup" aria-labelledby={labelId} className={f.choices}>
        {options.map((opt) => (
          <label key={opt} className={f.choice}>
            <input
              type="radio"
              className={f.radio}
              name={q.id}
              value={opt}
              checked={cur === opt}
              onChange={() => onChange({ kind: "choice", value: opt })}
            />
            <span className={f.dot} aria-hidden="true" />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  return (
    <textarea
      ref={textRef}
      className={f.text}
      aria-labelledby={labelId}
      rows={4}
      placeholder="Type your answer"
      value={value.kind === "text" ? value.value : ""}
      onChange={(e) => onChange({ kind: "text", value: e.target.value })}
    />
  );
}

/**
 * What Tab stops on inside the form, in order: each enabled control, and of a
 * group of radios only the chosen one (or the first, when none is), as the
 * browser does.
 */
function tabStops(box: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const groups = new Set<string>();
  for (const el of box.querySelectorAll<HTMLElement>("button, textarea, input")) {
    if (el.matches(":disabled") || el.tabIndex < 0) continue;
    if (el instanceof HTMLInputElement && el.type === "radio") {
      if (groups.has(el.name)) continue;
      groups.add(el.name);
      const chosen = [...box.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
        (r) => r.name === el.name && r.checked,
      );
      out.push(chosen ?? el);
      continue;
    }
    out.push(el);
  }
  return out;
}

/** The discount's tag, the header chip's shape (WorldV6.tsx TagGlyph). */
function TagGlyph() {
  return (
    <svg className={f.tag} width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
      <path
        d="M1.2 5.5 4.9 1.3c.2-.2.5-.3.7-.3h8.3c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H5.6c-.3 0-.5-.1-.7-.3L1.2 5.5Z"
        fill="currentColor"
      />
      <circle cx="5.6" cy="5.5" r="1.15" fill="#1b151b" />
    </svg>
  );
}

function Arrow({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
