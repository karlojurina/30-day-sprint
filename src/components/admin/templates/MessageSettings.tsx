"use client";

import { useId, useState } from "react";
import { Button, Card, Pill, T } from "@/components/admin/ui";
import { ReadFailure } from "@/components/admin/review-parts";
import {
  LINK_PLACEHOLDER,
  masterTurnOnText,
  messagesUsing,
  settingsWarnings,
  switchViews,
} from "@/lib/admin/templates-data";
import type { SettingsRead, SwitchView } from "@/lib/admin/templates-data";
import type { EditableConfigKey } from "@/lib/admin/config-keys";
import type { LiveRead } from "@/lib/template-on-off";
import type { Template } from "@/types/database";
import { Field, INPUT, SubHeading, WarningLine } from "./form-parts";

/**
 * Message settings, on the Templates page (admin rebuild 2, PRD D6): the 2
 * links the messages fill in and the 4 automated Discord switches, which
 * the Settings and Discord test pages edited until they were removed.
 *
 * Every team role reads it; founders and admins change it through PUT
 * /api/admin/config, which writes only these 6 keys (config-keys.ts). The
 * panel warns when the Discord link is empty (and how many messages then
 * send it empty) and when the program link is not on
 * sprint.ecomuniversity.com. A switch under the master posts only while the
 * master is on, and its state says so. Turning the master on asks once,
 * naming what starts posting.
 *
 * Since the review's fix round it is one line at the top of the page (the
 * templates are the page): "Message settings" and what it holds, a button
 * ("Show settings", "Hide settings") that opens the links and the switches,
 * and under it the warnings, always
 * shown. It opens folded for every role, a warning standing or not, so the
 * first template is on the first screen; the warnings say what to fix and
 * the button is one press away. The one sentence about who can change it
 * is here. SettingsBody is exported for the client tests, which render it
 * open.
 */

type Saver = (key: EditableConfigKey, value: string) => Promise<string | null>;

const LINK_FIELDS: Array<{ key: "program_login_link" | "discord_invite_link"; label: string; placeholder: string }> = [
  { key: "program_login_link", label: "Program link", placeholder: "https://sprint.ecomuniversity.com/login" },
  { key: "discord_invite_link", label: "Discord invite link", placeholder: "https://discord.gg/your-invite" },
];

export function MessageSettings({
  settings,
  templates,
  live,
  canEdit,
  onSave,
}: {
  settings: SettingsRead;
  templates: Template[];
  live: LiveRead;
  canEdit: boolean;
  /** Writes one key; answers null when it went through, else the sentence to show. */
  onSave: Saver;
}) {
  const panelId = useId();
  const warnings = settings.ok ? settingsWarnings(settings.values, templates, live) : [];
  const [open, setOpen] = useState(false);
  const who = canEdit ? "Founders and admins can change them." : "Only a founder or an admin can change them.";
  return (
    <Card padding={0} style={{ marginBottom: 24 }}>
      <section aria-labelledby="message-settings-title" data-settings-open={open ? "yes" : "no"}>
        <div className="flex flex-wrap items-center justify-between" style={{ gap: "8px 16px", padding: "12px 16px" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <h2 id="message-settings-title" style={T.cardTitle}>
              Message settings
            </h2>
            <p style={{ ...T.bodyDim, marginTop: 2, lineHeight: 1.5 }}>
              The links the messages fill in, and the automated Discord posts. {who}
            </p>
          </div>
          {settings.ok && (
            <Button variant="raised" size="md" onClick={() => setOpen((v) => !v)} title={open ? "Hide the links and the switches" : "Show the links and the switches"}>
              {open ? "Hide settings" : "Show settings"}
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ flex: "none", transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}>
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
          )}
        </div>
        {!settings.ok ? (
          <div role="alert" style={{ padding: "0 16px 16px" }}>
            <ReadFailure lead="Couldn't load the message settings. Press Refresh to try again." raw={settings.error} />
          </div>
        ) : (
          <>
            {warnings.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 16px 16px" }}>
                {warnings.map((w) => (
                  <WarningLine key={w.key}>{w.text}</WarningLine>
                ))}
              </div>
            )}
            {open && (
              <div id={panelId} style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 16px 20px", borderTop: "1px solid var(--color-border)" }}>
                <SettingsBody settings={settings} templates={templates} live={live} canEdit={canEdit} onSave={onSave} />
              </div>
            )}
          </>
        )}
      </section>
    </Card>
  );
}

export function SettingsBody({
  settings,
  templates,
  live,
  canEdit,
  onSave,
}: {
  settings: Extract<SettingsRead, { ok: true }>;
  templates: Template[];
  live: LiveRead;
  canEdit: boolean;
  onSave: Saver;
}) {
  const values = settings.values;
  const { master, others } = switchViews(values);
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 12 }}>
        <SubHeading>Links</SubHeading>
        {LINK_FIELDS.map((f) => (
          <LinkField
            // A save, or a fresh read, changes the saved value: the field starts again from it.
            key={`${f.key}:${values[f.key] ?? ""}`}
            settingKey={f.key}
            label={f.label}
            placeholder={f.placeholder}
            saved={values[f.key]}
            users={messagesUsing(templates, live, LINK_PLACEHOLDER[f.key]).length}
            canEdit={canEdit}
            onSave={onSave}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SubHeading>Automated Discord posts</SubHeading>
        <SwitchRow view={master} canEdit={canEdit} onSave={onSave} confirmOn={masterTurnOnText(values)} />
        <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
          Each switch below acts only while the master switch is on.
        </p>
        {others.map((v) => (
          <SwitchRow key={v.key} view={v} canEdit={canEdit} onSave={onSave} />
        ))}
      </div>
    </>
  );
}

function LinkField({
  settingKey,
  label,
  placeholder,
  saved,
  users,
  canEdit,
  onSave,
}: {
  settingKey: "program_login_link" | "discord_invite_link";
  label: string;
  placeholder: string;
  /** null: the key has no row, so nothing can be saved to it. */
  saved: string | null;
  users: number;
  canEdit: boolean;
  onSave: Saver;
}) {
  const id = useId();
  const [draft, setDraft] = useState(saved ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placeholderName = `{${LINK_PLACEHOLDER[settingKey]}}`;
  const hint =
    saved === null
      ? "This setting has no row in the database, so it cannot be saved here."
      : `Fills ${placeholderName} in ${users} ${users === 1 ? "message" : "messages"}.`;
  const changed = saved !== null && draft.trim() !== saved.trim();

  if (!canEdit) {
    return (
      <Field label={label} htmlFor={id} hint={hint}>
        <p id={id} style={{ ...T.body, fontSize: 15, overflowWrap: "anywhere" }}>
          {saved ? saved : <span style={{ color: "var(--color-text-secondary)" }}>Empty</span>}
        </p>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        <input
          id={id}
          type="url"
          inputMode="url"
          value={draft}
          disabled={saved === null || busy}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          style={{ ...INPUT, flex: "1 1 260px", width: "auto", minWidth: 0 }}
        />
        <Button
          variant="raised"
          size="md"
          busy={busy}
          disabled={!changed}
          onClick={async () => {
            setBusy(true);
            const said = await onSave(settingKey, draft.trim());
            setBusy(false);
            setError(said);
          }}
        >
          {busy ? "Saving" : "Save"}
        </Button>
      </div>
      {error && (
        <p role="alert" style={{ ...T.body, lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </Field>
  );
}

function SwitchRow({
  view,
  canEdit,
  onSave,
  confirmOn,
}: {
  view: SwitchView;
  canEdit: boolean;
  onSave: Saver;
  /** Set for the master switch: Turn on asks once, with this line. */
  confirmOn?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = view.on === null ? "neutral" : view.on ? (view.state === "On" ? "success" : "warning") : "neutral";

  async function set(on: boolean) {
    setBusy(true);
    setError(null);
    const said = await onSave(view.key, on ? "true" : "false");
    setBusy(false);
    setAsking(false);
    setError(said);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex flex-wrap items-start" style={{ gap: 12 }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <p style={{ ...T.body, fontSize: 15, fontWeight: 600 }}>{view.title}</p>
          <p style={{ ...T.bodyDim, marginTop: 2, lineHeight: 1.5 }}>{view.description}</p>
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <Pill tone={tone}>{view.state}</Pill>
          {canEdit && view.on !== null && !asking && (
            <Button
              variant="raised"
              size="md"
              busy={busy}
              onClick={() => {
                if (!view.on && confirmOn) setAsking(true);
                else void set(!view.on);
              }}
            >
              {view.on ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>
      </div>
      {asking && confirmOn && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ ...T.body, lineHeight: 1.5 }}>Turn on automated Discord posts? {confirmOn}</p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button variant="raised" size="md" busy={busy} onClick={() => void set(true)}>
              Yes, turn on
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
    </div>
  );
}
