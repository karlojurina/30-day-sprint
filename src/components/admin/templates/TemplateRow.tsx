"use client";

import { useId, useState } from "react";
import { Button, Pill, T } from "@/components/admin/ui";
import { TemplateOnOff } from "@/components/admin/TemplateOnOff";
import { TriggerBuilder } from "@/components/admin/TriggerBuilder";
import { onOffView } from "@/lib/template-on-off";
import type { LiveRead } from "@/lib/template-on-off";
import { renderTemplate, stripBucketGlyph } from "@/lib/templates";
import {
  BUCKET_OPTIONS,
  BUCKET_WORDS,
  canDelete,
  isDirty,
  previewConfig,
  unresolvedLine,
} from "@/lib/admin/templates-data";
import type {
  DraftFields,
  SettingsRead,
  TemplateStat,
  TriggerCatalogRead,
} from "@/lib/admin/templates-data";
import type { Template, TemplateBucket } from "@/types/database";
import { Field, INPUT, TEXTAREA } from "./form-parts";

/**
 * One template on /admin/templates (admin rebuild 2, WI-8): its line in the
 * list (title, bucket in words, its numbers, Off where its switch works, any
 * unsaved change), and when open, the editor: on or off, the fields, the
 * conditions, the message, its preview, Save and, for a custom template
 * only, Delete.
 *
 * The preview fills {programLink} and {discordInvite} with the live message
 * settings (previewConfig), never a host written here; a placeholder left as
 * written gets a line saying why.
 */

/** The made-up student the preview is written to. Read once, at load. */
const SAMPLE_STUDENT = {
  name: "Mike Smith",
  joined_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
};

export interface RowHandlers {
  onToggleOpen: () => void;
  onDraft: (next: DraftFields) => void;
  /** Saves the changed fields; null when it went through, else the sentence to show. */
  onSave: () => Promise<string | null>;
  onSetActive: () => void;
  /** Deletes a custom template; null when it went through, else the sentence to show. */
  onDelete: () => Promise<string | null>;
}

export function TemplateRow({
  template: t,
  draft,
  open,
  stat,
  live,
  trigger,
  settings,
  canEdit,
  busy,
  handlers,
}: {
  template: Template;
  draft: DraftFields;
  open: boolean;
  stat: TemplateStat | undefined;
  live: LiveRead;
  trigger: TriggerCatalogRead;
  settings: SettingsRead;
  canEdit: boolean;
  /** True while this template is being saved, switched or deleted. */
  busy: boolean;
  handlers: RowHandlers;
}) {
  const panelId = useId();
  const dirty = isDirty(t, draft);
  // The on/off switch, only where it stops the template's tasks, and why Turn on waits (template-on-off.ts).
  const onOff = onOffView(t, live, dirty);
  const meta = [BUCKET_WORDS[t.bucket] ?? t.bucket, ...statWords(stat)].join(" · ");

  return (
    <div
      className="list-row"
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        padding: 0,
        boxShadow: dirty ? "inset 3px 0 0 var(--color-accent-dark)" : undefined,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={handlers.onToggleOpen}
        className="w-full text-left"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 64,
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <span style={{ flex: "1 1 auto", minWidth: 0 }}>
          <span style={{ ...T.body, display: "block", fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>
            {stripBucketGlyph(t.title)}
          </span>
          <span style={{ ...T.bodyDim, display: "block", marginTop: 2, lineHeight: 1.45 }}>{meta}</span>
        </span>
        <span className="flex flex-wrap items-center justify-end" style={{ gap: 6, flex: "none", maxWidth: "45%" }}>
          {onOff.kind === "switch" && !onOff.on && <Pill tone="warning">Off</Pill>}
          {t.is_admin_only && <Pill tone="neutral">Admin only</Pill>}
          {dirty && <Pill tone="accent">Unsaved</Pill>}
        </span>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          style={{ flex: "none", transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: "4px 16px 18px",
          }}
        >
          <TemplateOnOff view={onOff} canEdit={canEdit} busy={busy} onToggle={handlers.onSetActive} />
          {canEdit ? (
            <EditFields template={t} draft={draft} trigger={trigger} busy={busy} onDraft={handlers.onDraft} />
          ) : (
            <ReadFields template={t} trigger={trigger} />
          )}
          {!t.is_admin_only && (
            <RowActions
              template={t}
              draft={draft}
              settings={settings}
              canEdit={canEdit}
              dirty={dirty}
              busy={busy}
              onSave={handlers.onSave}
              onDelete={handlers.onDelete}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** "32 sent", "40% success", "8 graded on the old course", "3 replied": what the row shows of the template's numbers. */
export function statWords(s: TemplateStat | undefined): string[] {
  if (!s || s.created === 0) return [];
  const out = [`${s.sent} sent`];
  if (s.success_eligible > 0) out.push(`${Math.round((s.success / s.success_eligible) * 100)}% success`);
  if (s.graded_on_old_course > 0) out.push(`${s.graded_on_old_course} graded on the old course`);
  if (s.replied > 0) out.push(`${s.replied} replied`);
  return out;
}

function EditFields({
  template: t,
  draft,
  trigger,
  busy,
  onDraft,
}: {
  template: Template;
  draft: DraftFields;
  trigger: TriggerCatalogRead;
  busy: boolean;
  onDraft: (next: DraftFields) => void;
}) {
  const id = useId();
  const set = <K extends keyof DraftFields>(k: K, v: DraftFields[K]) => onDraft({ ...draft, [k]: v });
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`}>
        <input
          id={`${id}-title`}
          type="text"
          value={draft.title}
          disabled={busy}
          onChange={(e) => set("title", e.target.value)}
          style={INPUT}
        />
      </Field>
      <Field label="Bucket" htmlFor={`${id}-bucket`} hint="What kind of moment this is. Tasks sort by it.">
        <select
          id={`${id}-bucket`}
          value={draft.bucket}
          disabled={busy}
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
      <TriggerBuilder
        value={draft.trigger_config}
        disabled={busy}
        catalog={trigger}
        onChange={(next) => set("trigger_config", next)}
      />
      {!t.is_custom && (
        <Field
          label="Trigger note"
          htmlFor={`${id}-note`}
          hint="For the team only: when this message comes up, in words. The conditions above decide it."
        >
          <textarea
            id={`${id}-note`}
            rows={2}
            value={draft.trigger_description}
            disabled={busy}
            onChange={(e) => set("trigger_description", e.target.value)}
            style={TEXTAREA}
          />
        </Field>
      )}
      <Field label="Intent" htmlFor={`${id}-intent`} hint="What the message is trying to do.">
        <textarea
          id={`${id}-intent`}
          rows={2}
          value={draft.intent}
          disabled={busy}
          onChange={(e) => set("intent", e.target.value)}
          style={TEXTAREA}
        />
      </Field>
      {!t.is_admin_only ? (
        <Field
          label="Message"
          htmlFor={`${id}-body`}
          hint="{firstName}, {fullName}, {dayNumber}, {programLink} and {discordInvite} are filled in when a task copies it."
        >
          <textarea
            id={`${id}-body`}
            rows={Math.max(8, Math.min(24, draft.body.split("\n").length + 1))}
            value={draft.body}
            disabled={busy}
            onChange={(e) => set("body", e.target.value)}
            style={TEXTAREA}
          />
        </Field>
      ) : (
        <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
          This one shows in the team&apos;s task list only. It sends nothing to a student, so it has no message.
        </p>
      )}
    </>
  );
}

/** What a team member who cannot edit sees: the same fields as text. */
function ReadFields({ template: t, trigger }: { template: Template; trigger: TriggerCatalogRead }) {
  return (
    <>
      <TriggerBuilder value={t.trigger_config ?? { all: [] }} disabled catalog={trigger} onChange={() => {}} />
      {!t.is_custom && t.trigger_description && <ReadText label="Trigger note" text={t.trigger_description} />}
      {t.intent && <ReadText label="Intent" text={t.intent} />}
      {!t.is_admin_only && <ReadText label="Message" text={t.body || "No message yet."} />}
    </>
  );
}

function ReadText({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={{ ...T.eyebrow, color: "var(--color-text-secondary)" }}>{label}</p>
      <p style={{ ...T.body, fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {text}
      </p>
    </div>
  );
}

function RowActions({
  template: t,
  draft,
  settings,
  canEdit,
  dirty,
  busy,
  onSave,
  onDelete,
}: {
  template: Template;
  draft: DraftFields;
  settings: SettingsRead;
  canEdit: boolean;
  dirty: boolean;
  busy: boolean;
  onSave: () => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const [preview, setPreview] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletable = canEdit && canDelete(t);

  // Delete, red, at the start of the row, away from Preview and Save at its end (the review's fix round).
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        {deletable && !asking && (
          <Button variant="danger" size="md" disabled={busy} onClick={() => setAsking(true)}>
            Delete template
          </Button>
        )}
        <span className="flex flex-wrap items-center justify-end" style={{ gap: 8, marginLeft: "auto" }}>
          {canEdit && !dirty && <span style={T.bodyDim}>No changes to save</span>}
          <Button variant="raised" size="md" onClick={() => setPreview((p) => !p)}>
            {preview ? "Hide preview" : "Show preview"}
          </Button>
          {canEdit && (
            <Button
              variant="raised"
              size="md"
              busy={busy}
              disabled={!dirty}
              onClick={async () => {
                setError(await onSave());
              }}
            >
              {busy ? "Saving" : "Save"}
            </Button>
          )}
        </span>
      </div>

      {asking && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 12,
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
          }}
        >
          <p style={{ ...T.body, lineHeight: 1.5 }}>
            Delete this template? Tasks it already made stay in Tasks, without it. This cannot be undone.
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button
              variant="danger"
              size="md"
              busy={busy}
              onClick={async () => {
                const said = await onDelete();
                if (said) {
                  setError(said);
                  setAsking(false);
                }
              }}
            >
              Yes, delete it
            </Button>
            <Button variant="ghost" size="md" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ ...T.body, lineHeight: 1.5 }}>
          {error}
        </p>
      )}

      {preview && <TemplatePreview body={draft.body} settings={settings} />}
    </div>
  );
}

/** The message as a task would copy it: the sample student's name and the live links. */
export function TemplatePreview({ body, settings }: { body: string; settings: SettingsRead }) {
  const rendered = renderTemplate(body, { student: SAMPLE_STUDENT, config: previewConfig(settings) });
  return (
    <div
      style={{
        padding: 14,
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <p style={{ ...T.eyebrow, color: "var(--color-text-secondary)", marginBottom: 8 }}>
        Preview for a sample student, {SAMPLE_STUDENT.name}, with the live links
      </p>
      <p style={{ ...T.body, fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {rendered.body}
      </p>
      {rendered.unresolved.length > 0 && (
        <ul style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {rendered.unresolved.map((name) => (
            <li key={name} style={{ ...T.body, lineHeight: 1.5, color: "var(--color-warning)" }}>
              {unresolvedLine(name, settings)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
