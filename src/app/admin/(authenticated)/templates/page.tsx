"use client";

/**
 * /admin/templates — the canonical editor for all 20 Astrid DM templates
 * + the 1 admin-only W2.6 metadata row.
 *
 * Anything written here is the single source of truth — tasks rendered
 * by the queue read straight from this table, so an edit propagates to
 * every future copy.
 *
 * Founder + admin can edit. CSMs see the templates read-only.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import type {
  Template,
  TemplateBucket,
  TriggerConfig,
} from "@/types/database";
import {
  BUCKET_GLYPH,
  renderTemplate,
  stripBucketGlyph,
} from "@/lib/templates";
import { TriggerBuilder } from "@/components/admin/TriggerBuilder";
import { AdminPage, PageHeader, Button, T } from "@/components/admin/ui";

// v58 - day-based ordering. After the v57 rename the week column
// holds day-prefixed buckets (D01, D03, D05, D07, D10, D14, D21, M2)
// + CUSTOM for Karlo's home-rolled templates. The order matches a
// student's journey from welcome to month 2.
const WEEK_ORDER = [
  "D01",
  "D03",
  "D05",
  "D07",
  "D10",
  "D14",
  "D21",
  "M2",
  "CUSTOM",
];

const BUCKET_OPTIONS: Array<{ value: TemplateBucket; label: string }> = [
  { value: "crushing", label: "★ Crushing it" },
  { value: "on_track", label: "✓ On track" },
  { value: "at_risk", label: "⚠ At risk" },
  { value: "cancel_path", label: "✗ Cancel path" },
  { value: "event", label: "⚡ Event" },
];

const GROUP_LABEL: Record<string, string> = {
  D01: "Day 1 - Welcome",
  D03: "Day 3",
  D05: "Day 5",
  D07: "Day 7",
  D10: "Day 10",
  D14: "Day 14",
  D21: "Day 21",
  M2: "Month 2",
  CUSTOM: "Your custom templates",
};

function weekRank(w: string | null): number {
  if (!w) return 99;
  const i = WEEK_ORDER.indexOf(w);
  return i === -1 ? 99 : i;
}

interface DraftFields {
  title: string;
  trigger_description: string;
  intent: string;
  tone: string;
  body: string;
  /** Only meaningful for custom templates. Built-ins ignore these two. */
  bucket: TemplateBucket;
  trigger_config: TriggerConfig;
}

const EMPTY_TRIGGER: TriggerConfig = { all: [] };

/** Phase 0 — per-template effectiveness from /api/admin/templates/stats. */
interface TemplateStatLite {
  created: number;
  open: number;
  sent: number;
  dismissed: number;
  replied: number;
  no_reply: number;
  /** v85.3 — per-family success (see /admin/tasks/insights methodology). */
  success: number;
  success_eligible: number;
  success_label: string;
}


function emptyDraft(): DraftFields {
  return {
    title: "",
    trigger_description: "",
    intent: "",
    tone: "",
    body: "",
    bucket: "at_risk",
    trigger_config: { all: [] },
  };
}

export default function AdminTemplatesPage() {
  const { teamMember } = useAuth();
  const supabase = createClient();
  const [rows, setRows] = useState<Template[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previewOn, setPreviewOn] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // "New custom template" modal state.
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newDraft, setNewDraft] = useState<DraftFields>(emptyDraft());
  const [creating, setCreating] = useState(false);

  const canEdit =
    teamMember?.role === "founder" || teamMember?.role === "admin";

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 0 — load per-template effectiveness. Non-fatal: the editor
  // works fine without stats, so failures are swallowed silently.
  const [stats, setStats] = useState<Record<
    string,
    TemplateStatLite
  > | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const res = await fetch("/api/admin/templates/stats", {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const json = (await res.json()) as {
            stats: Record<string, TemplateStatLite>;
          };
          setStats(json.stats);
        }
      } catch {
        // stats are additive — never block the editor on them
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("templates")
      .select("*")
      .order("week", { nullsFirst: false })
      .order("scenario_id");
    const list = ((data as Template[] | null) ?? []).sort(
      (a, b) => weekRank(a.week) - weekRank(b.week) || a.scenario_id.localeCompare(b.scenario_id),
    );
    setRows(list);
    setDrafts(
      Object.fromEntries(
        list.map((t) => [
          t.id,
          {
            title: t.title,
            trigger_description: t.trigger_description,
            intent: t.intent ?? "",
            tone: t.tone ?? "",
            body: t.body,
            bucket: t.bucket,
            trigger_config: t.trigger_config ?? EMPTY_TRIGGER,
          },
        ]),
      ),
    );
    setLoading(false);
  }

  /** Open the New Custom Template modal with a fresh draft. */
  function startNewTemplate() {
    setNewDraft(emptyDraft());
    setNewModalOpen(true);
    setError(null);
  }

  function closeNewTemplate() {
    setNewModalOpen(false);
    setNewDraft(emptyDraft());
  }

  async function createTemplate() {
    setError(null);
    if (!newDraft.title.trim()) {
      setError("Add a title before saving.");
      return;
    }
    if (!newDraft.body.trim()) {
      setError("Add the DM body before saving.");
      return;
    }
    if (newDraft.trigger_config.all.length === 0) {
      setError("Add at least one trigger condition.");
      return;
    }
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: newDraft.title,
          intent: newDraft.intent,
          trigger_description: "",
          body: newDraft.body,
          bucket: newDraft.bucket,
          trigger_config: newDraft.trigger_config,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { template } = await res.json();
      setRows((prev) => [template, ...prev]);
      setDrafts((prev) => ({
        ...prev,
        [template.id]: {
          title: template.title,
          trigger_description: template.trigger_description,
          intent: template.intent ?? "",
          tone: template.tone ?? "",
          body: template.body,
          bucket: template.bucket,
          trigger_config: template.trigger_config ?? EMPTY_TRIGGER,
        },
      }));
      setExpanded(template.id);
      closeNewTemplate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCreating(false);
  }

  async function deleteTemplate(id: string) {
    if (
      !confirm(
        "Delete this template? This can't be undone. Existing tasks that referenced it will remain visible but lose the link.",
      )
    ) {
      return;
    }
    setSaving(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/templates/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setExpanded((cur) => (cur === id ? null : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(null);
  }

  async function save(id: string) {
    setError(null);
    setSaving(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const draft = drafts[id];
      const existing = rows.find((r) => r.id === id);
      const payload: Record<string, unknown> = {
        title: draft.title,
        trigger_description: draft.trigger_description,
        intent: draft.intent,
        tone: draft.tone,
        body: draft.body,
      };
      // Karlo wants full control over when each template fires —
      // built-ins are no longer locked out of bucket / trigger_config
      // changes. The backend API accepts both fields for any template.
      payload.bucket = draft.bucket;
      payload.trigger_config = draft.trigger_config;
      const res = await fetch(`/api/admin/templates/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { template } = await res.json();
      setRows((prev) => prev.map((r) => (r.id === id ? template : r)));
      setSavedId(template.id);
      setTimeout(
        () => setSavedId((cur) => (cur === template.id ? null : cur)),
        1500,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(null);
  }

  function updateDraft(
    id: string,
    field: keyof DraftFields,
    value: string | TriggerConfig | TemplateBucket,
  ) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  function isDirty(t: Template): boolean {
    const d = drafts[t.id];
    if (!d) return false;
    return (
      d.title !== t.title ||
      d.trigger_description !== t.trigger_description ||
      d.intent !== (t.intent ?? "") ||
      d.tone !== (t.tone ?? "") ||
      d.body !== t.body ||
      d.bucket !== t.bucket ||
      JSON.stringify(d.trigger_config) !==
        JSON.stringify(t.trigger_config ?? EMPTY_TRIGGER)
    );
  }

  // Group templates by week, with custom templates rolled into their
  // own "CUSTOM" group regardless of the stored week value.
  const groupedRows = useMemo(() => {
    const groups: Record<string, Template[]> = {};
    for (const r of rows) {
      const key = r.is_custom ? "CUSTOM" : r.week ?? "(other)";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return Object.entries(groups).sort(
      ([a], [b]) => weekRank(a) - weekRank(b),
    );
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className="rounded-full animate-spin"
          style={{
            width: 24,
            height: 24,
            border: "2px solid var(--color-accent)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title="Templates"
        actions={
          canEdit ? (
            <Button variant="primary" size="md" onClick={startNewTemplate}>
              + New custom template
            </Button>
          ) : undefined
        }
      />
      <BucketLegend />

      {!canEdit && (
        <div
          style={{
            background: "rgba(212,162,76,0.10)",
            border: "1px solid rgba(212,162,76,0.30)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--color-warning)",
            marginBottom: 16,
          }}
        >
          You&apos;re signed in as <strong>{teamMember?.role}</strong>. Only
          founder / admin roles can edit templates — viewing is read-only.
        </div>
      )}

      {error && (
        <div
          style={{
            background: "rgba(200,74,74,0.10)",
            border: "1px solid rgba(200,74,74,0.30)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--color-danger)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6">
        {groupedRows.map(([weekKey, group]) => (
          <section key={weekKey}>
            <h2 style={{ ...T.eyebrow, marginBottom: 8 }}>
              {GROUP_LABEL[weekKey] ?? weekKey}
            </h2>

            <div className="flex flex-col gap-2">
              {group.map((t) => {
                const isOpen = expanded === t.id;
                const dirty = isDirty(t);
                const isPreview = previewOn[t.id] === true;
                const draft = drafts[t.id];
                const preview = draft
                  ? renderTemplate(draft.body, {
                      student: {
                        name: "Mike Smith",
                        joined_at: new Date(
                          Date.now() - 5 * 86_400_000,
                        ).toISOString(),
                      },
                      config: {
                        program_login_link:
                          "https://30-day-sprint-smkv.vercel.app/login",
                        discord_invite_link:
                          "https://discord.gg/<server>",
                      },
                    })
                  : null;
                const glyph = BUCKET_GLYPH[t.bucket] ?? "·";

                return (
                  <div
                    key={t.id}
                    className="rounded"
                    style={{
                      background: "var(--color-bg-elevated)",
                      border: dirty
                        ? "1px solid var(--color-accent)"
                        : "1px solid var(--color-border)",
                    }}
                  >
                    {/* Row header */}
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : t.id)}
                      className="w-full text-left flex items-center gap-3 px-4 py-3"
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        title={t.bucket}
                        style={{
                          fontSize: 14,
                          color:
                            t.bucket === "at_risk"
                              ? "var(--color-warning)"
                              : t.bucket === "cancel_path"
                                ? "var(--color-danger)"
                                : t.bucket === "crushing"
                                  ? "var(--color-accent)"
                                  : "var(--color-text-tertiary)",
                          minWidth: 16,
                        }}
                      >
                        {glyph}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {stripBucketGlyph(t.title)}
                      </span>
                      {(() => {
                        // Phase 0 — effectiveness at a glance. Hidden
                        // until this template has ever fired a task.
                        // Full breakdown lives on /admin/tasks/insights.
                        const s = stats?.[t.id];
                        if (!s || s.created === 0) return null;
                        const success =
                          s.success_eligible > 0
                            ? ` · ${Math.round((s.success / s.success_eligible) * 100)}% success`
                            : "";
                        const replied =
                          s.replied > 0 ? ` · ${s.replied} replied` : "";
                        return (
                          <span
                            title={`sent = DMs marked sent · success = ${s.success_label} (${s.success}/${s.success_eligible}) · replied = manual tap on the Sent tab · full breakdown on the tasks Insights tab`}
                            style={{
                              fontSize: 11,
                              color: "var(--color-text-tertiary)",
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {s.sent} sent{success}
                            {replied}
                          </span>
                        );
                      })()}
                      {t.is_admin_only && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 3,
                            background: "rgba(140,140,130,0.18)",
                            color: "var(--color-text-tertiary)",
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                        >
                          Admin-only
                        </span>
                      )}
                      {dirty && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-accent-dark)",
                            fontWeight: 600,
                          }}
                        >
                          • unsaved
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-tertiary)",
                        }}
                      >
                        {isOpen ? "▴" : "▾"}
                      </span>
                    </button>

                    {isOpen && draft && (
                      <div
                        className="px-4 pb-4"
                        style={{ borderTop: "1px solid var(--color-border)" }}
                      >
                        {/* Editable fields */}
                        <div style={{ marginTop: 14 }}>
                          <Field label="Title">
                            <input
                              type="text"
                              disabled={!canEdit}
                              value={draft.title}
                              onChange={(e) =>
                                updateDraft(t.id, "title", e.target.value)
                              }
                              placeholder={
                                t.is_custom
                                  ? "Short, descriptive — e.g. \"Slow start, no action by day 4\""
                                  : undefined
                              }
                              style={fieldStyle()}
                            />
                          </Field>

                          {/* Bucket + visual trigger builder. Shown for
                              ALL templates now — Karlo wants to be able
                              to retune the structural conditions for
                              built-ins too, not just the body copy. */}
                          <Field label="Bucket (what kind of moment this is)">
                            <select
                              disabled={!canEdit}
                              value={draft.bucket}
                              onChange={(e) =>
                                updateDraft(
                                  t.id,
                                  "bucket",
                                  e.target.value as TemplateBucket,
                                )
                              }
                              style={fieldStyle()}
                            >
                              {BUCKET_OPTIONS.map((b) => (
                                <option key={b.value} value={b.value}>
                                  {b.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <div style={{ marginBottom: 12 }}>
                            <TriggerBuilder
                              value={draft.trigger_config}
                              disabled={!canEdit}
                              onChange={(next) =>
                                updateDraft(t.id, "trigger_config", next)
                              }
                            />
                          </div>

                          {/* Built-ins also carry a human-readable trigger
                              note from the seed. Keep it editable as a
                              supplemental description (the TriggerBuilder
                              above is the source of truth for evaluation). */}
                          {!t.is_custom && (
                            <Field label="Trigger note (human description, optional)">
                              <textarea
                                disabled={!canEdit}
                                rows={2}
                                value={draft.trigger_description}
                                onChange={(e) =>
                                  updateDraft(
                                    t.id,
                                    "trigger_description",
                                    e.target.value,
                                  )
                                }
                                style={fieldStyle()}
                              />
                            </Field>
                          )}
                          <Field label="Intent (what the DM is trying to do)">
                            <textarea
                              disabled={!canEdit}
                              rows={2}
                              value={draft.intent}
                              onChange={(e) =>
                                updateDraft(t.id, "intent", e.target.value)
                              }
                              style={fieldStyle()}
                            />
                          </Field>
                        </div>

                        {/* Body — the actual DM */}
                        {!t.is_admin_only && (
                          <Field label="DM body">
                            <textarea
                              disabled={!canEdit}
                              rows={Math.max(8, Math.min(24, draft.body.split("\n").length + 1))}
                              value={draft.body}
                              onChange={(e) =>
                                updateDraft(t.id, "body", e.target.value)
                              }
                              style={{
                                ...fieldStyle(),
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                                fontSize: 13,
                                lineHeight: 1.55,
                              }}
                            />
                          </Field>
                        )}
                        {t.is_admin_only && (
                          <p
                            className="mt-2 mb-3"
                            style={{
                              fontSize: 12,
                              color: "var(--color-text-tertiary)",
                              fontStyle: "italic",
                            }}
                          >
                            This scenario surfaces in the admin task queue
                            only — there&apos;s no student DM, so no body.
                          </p>
                        )}

                        {/* Preview + Save / Delete row */}
                        {!t.is_admin_only && (
                          <div className="flex items-start gap-2 mt-3 flex-wrap">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewOn((prev) => ({
                                  ...prev,
                                  [t.id]: !prev[t.id],
                                }))
                              }
                              style={ghostBtnStyle()}
                            >
                              {isPreview ? "Hide preview" : "Show preview"}
                            </button>
                            <button
                              type="button"
                              disabled={!canEdit || saving === t.id}
                              onClick={() => void deleteTemplate(t.id)}
                              style={{
                                ...ghostBtnStyle(),
                                color: "var(--color-danger)",
                                borderColor: "rgba(200,74,74,0.30)",
                              }}
                            >
                              Delete template
                            </button>
                            <div className="flex-1" />
                            <button
                              type="button"
                              disabled={!canEdit || !dirty || saving === t.id}
                              onClick={() => void save(t.id)}
                              style={{
                                ...primaryBtnStyle(),
                                opacity:
                                  !canEdit || !dirty || saving === t.id
                                    ? 0.5
                                    : 1,
                                cursor:
                                  !canEdit || !dirty || saving === t.id
                                    ? "not-allowed"
                                    : "pointer",
                              }}
                            >
                              {saving === t.id
                                ? "Saving…"
                                : savedId === t.id
                                  ? "Saved ✓"
                                  : "Save"}
                            </button>
                          </div>
                        )}

                        {/* Preview pane */}
                        {!t.is_admin_only && isPreview && preview && (
                          <div
                            className="mt-3 p-3 rounded"
                            style={{
                              background: "var(--color-bg-primary)",
                              border: "1px solid var(--color-border)",
                              fontSize: 13,
                              lineHeight: 1.55,
                              whiteSpace: "pre-wrap",
                              color: "var(--color-text-primary)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                letterSpacing: "0.12em",
                                textTransform: "uppercase",
                                color: "var(--color-text-tertiary)",
                                marginBottom: 6,
                              }}
                            >
                              Preview · sample student “Mike Smith” · day 5
                            </div>
                            {preview.body}
                            {preview.unresolved.length > 0 && (
                              <p
                                style={{
                                  marginTop: 8,
                                  fontSize: 11,
                                  color: "var(--color-warning)",
                                }}
                              >
                                ⚠ Unresolved placeholders:{" "}
                                {preview.unresolved
                                  .map((v) => `{${v}}`)
                                  .join(", ")}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {newModalOpen && (
        <NewTemplateModal
          draft={newDraft}
          onChange={setNewDraft}
          onClose={closeNewTemplate}
          onCreate={() => void createTemplate()}
          creating={creating}
          error={error}
        />
      )}
    </AdminPage>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-3">
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function fieldStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    background: "var(--color-bg-primary)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    color: "var(--color-text-primary)",
    resize: "vertical",
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    background: "var(--color-accent)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-on-accent, #fff)",
    cursor: "pointer",
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    background: "transparent",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  };
}

/** Compact key card explaining the five bucket icons. Sits at the top
 *  of the Templates page so the glyphs on each row are self-documenting. */
function BucketLegend() {
  const items: Array<{
    glyph: string;
    label: string;
    desc: string;
    color: string;
  }> = [
    {
      glyph: "★",
      label: "Crushing it",
      desc: "Student hit a milestone — celebrate the win.",
      color: "var(--color-accent)",
    },
    {
      glyph: "✓",
      label: "On track",
      desc: "Default healthy state — light check-in to keep momentum.",
      color: "var(--color-text-tertiary)",
    },
    {
      glyph: "⚠",
      label: "At risk",
      desc: "Red flags before they slip — intervene early.",
      color: "var(--color-warning)",
    },
    {
      glyph: "✗",
      label: "Cancel path",
      desc: "Inactive / disengaged — last-chance re-engagement.",
      color: "var(--color-danger)",
    },
    {
      glyph: "⚡",
      label: "Event",
      desc: "Triggered by a specific moment (discount apply, reactivation, etc).",
      color: "var(--color-text-secondary)",
    },
  ];
  return (
    <div
      className="mb-6"
      style={{
        padding: 14,
        borderRadius: 10,
        background: "var(--color-fill-secondary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginBottom: 8,
        }}
      >
        Bucket legend
      </p>
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5"
        style={{ gap: 10 }}
      >
        {items.map((it) => (
          <div key={it.glyph} className="flex items-start gap-2">
            <span
              aria-hidden
              style={{
                color: it.color,
                fontSize: 14,
                lineHeight: 1,
                marginTop: 2,
              }}
            >
              {it.glyph}
            </span>
            <div>
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  lineHeight: 1.3,
                }}
              >
                {it.label}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  lineHeight: 1.4,
                  marginTop: 2,
                }}
              >
                {it.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────── New Template Modal ──────────────────────── */

function NewTemplateModal({
  draft,
  onChange,
  onClose,
  onCreate,
  creating,
  error,
}: {
  draft: DraftFields;
  onChange: (next: DraftFields) => void;
  onClose: () => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-template-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 32,
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border-hover)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          padding: 24,
        }}
      >
        <header
          className="flex items-baseline justify-between"
          style={{
            paddingBottom: 12,
            borderBottom: "1px solid var(--color-border)",
            marginBottom: 14,
          }}
        >
          <h2
            id="new-template-title"
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.018em",
            }}
          >
            New custom template
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              color: "var(--color-text-tertiary)",
              padding: 0,
              width: 28,
              height: 28,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder='e.g. "Push to start when day 5 hits with nothing watched"'
            style={fieldStyle()}
            autoFocus
          />
        </Field>
        <Field label="Bucket (what kind of moment this is)">
          <select
            value={draft.bucket}
            onChange={(e) =>
              onChange({ ...draft, bucket: e.target.value as TemplateBucket })
            }
            style={fieldStyle()}
          >
            {BUCKET_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ marginBottom: 12 }}>
          <TriggerBuilder
            value={draft.trigger_config}
            onChange={(next) => onChange({ ...draft, trigger_config: next })}
          />
        </div>
        <Field label="Intent (what the DM is trying to do — optional)">
          <textarea
            rows={2}
            value={draft.intent}
            onChange={(e) => onChange({ ...draft, intent: e.target.value })}
            style={fieldStyle()}
          />
        </Field>
        <Field label="DM body">
          <textarea
            rows={Math.max(6, Math.min(18, draft.body.split("\n").length + 2))}
            value={draft.body}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            placeholder={"Hey {firstName}!\n\n…"}
            style={{
              ...fieldStyle(),
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              lineHeight: 1.55,
            }}
          />
        </Field>

        {error && (
          <div
            className="mt-2 mb-3 p-3 rounded"
            style={{
              background: "rgba(200,74,74,0.10)",
              border: "1px solid rgba(200,74,74,0.30)",
              fontSize: 13,
              color: "var(--color-danger)",
            }}
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} style={ghostBtnStyle()}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            style={{
              ...primaryBtnStyle(),
              opacity: creating ? 0.6 : 1,
              cursor: creating ? "wait" : "pointer",
            }}
          >
            {creating ? "Creating…" : "Create template"}
          </button>
        </div>
      </div>
    </div>
  );
}

