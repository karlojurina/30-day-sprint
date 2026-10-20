"use client";

import { useEffect, useId, useState } from "react";
import { Button, T } from "@/components/admin/ui";
import { TriggerBuilder } from "@/components/admin/TriggerBuilder";
import { BUCKET_OPTIONS, BUCKET_WORDS, EMPTY_TRIGGER } from "@/lib/admin/templates-data";
import type { NewTemplateFields, TriggerCatalogRead } from "@/lib/admin/templates-data";
import type { TemplateBucket } from "@/types/database";
import { Field, INPUT, TEXTAREA } from "./form-parts";

/**
 * "New template" on /admin/templates (admin rebuild 2, WI-8): a custom
 * template, which POST /api/admin/templates makes with a C- scenario, on.
 * It needs a title, a message and at least one condition, as the route
 * does; the dialog says which is missing before it sends anything.
 * Escape and Cancel close it without saving.
 */

const EMPTY: NewTemplateFields = { title: "", intent: "", body: "", bucket: "at_risk", trigger_config: EMPTY_TRIGGER };

/** What is missing before a new template can be sent, or null. */
export function newTemplateProblem(f: NewTemplateFields): string | null {
  if (!f.title.trim()) return "Add a title first.";
  if (!f.body.trim()) return "Add the message first.";
  if (f.trigger_config.all.length === 0) return "Add at least one condition first.";
  return null;
}

export function NewTemplateDialog({
  trigger,
  onClose,
  onCreate,
}: {
  trigger: TriggerCatalogRead;
  onClose: () => void;
  /** Creates it; null when it went through, else the sentence to show. */
  onCreate: (fields: NewTemplateFields) => Promise<string | null>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<NewTemplateFields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof NewTemplateFields>(k: K, v: NewTemplateFields[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setError(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function create() {
    const problem = newTemplateProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const said = await onCreate({ ...draft, title: draft.title.trim(), intent: draft.intent.trim() });
    setBusy(false);
    if (said) setError(said);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-heading`}
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          margin: "24px 0",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 20,
          borderRadius: "var(--radius-sheet)",
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border-strong)",
        }}
      >
        <div>
          <h2 id={`${id}-heading`} style={T.heading}>
            New template
          </h2>
          <p style={{ ...T.bodyDim, marginTop: 4, lineHeight: 1.5 }}>
            A custom template. It is on as soon as it is made, and its conditions decide when a task comes up.
          </p>
        </div>
        <Field label="Title" htmlFor={`${id}-title`}>
          <input
            id={`${id}-title`}
            type="text"
            value={draft.title}
            autoFocus
            placeholder="For example: No lesson by day 5"
            onChange={(e) => set("title", e.target.value)}
            style={INPUT}
          />
        </Field>
        <Field label="Bucket" htmlFor={`${id}-bucket`}>
          <select
            id={`${id}-bucket`}
            value={draft.bucket}
            onChange={(e) => set("bucket", e.target.value as TemplateBucket)}
            style={INPUT}
          >
            {BUCKET_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {BUCKET_WORDS[b]}
              </option>
            ))}
          </select>
        </Field>
        <TriggerBuilder value={draft.trigger_config} catalog={trigger} onChange={(next) => set("trigger_config", next)} />
        <Field label="Intent (optional)" htmlFor={`${id}-intent`}>
          <textarea
            id={`${id}-intent`}
            rows={2}
            value={draft.intent}
            onChange={(e) => set("intent", e.target.value)}
            style={TEXTAREA}
          />
        </Field>
        <Field label="Message" htmlFor={`${id}-body`}>
          <textarea
            id={`${id}-body`}
            rows={Math.max(6, Math.min(18, draft.body.split("\n").length + 2))}
            value={draft.body}
            placeholder={"Hey {firstName}!"}
            onChange={(e) => set("body", e.target.value)}
            style={TEXTAREA}
          />
        </Field>
        {error && (
          <p role="alert" style={{ ...T.body, lineHeight: 1.5 }}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end" style={{ gap: 8 }}>
          <Button variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="raised" size="md" busy={busy} onClick={() => void create()}>
            {busy ? "Creating" : "Create template"}
          </Button>
        </div>
      </div>
    </div>
  );
}
