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
import type { Template } from "@/types/database";
import {
  BUCKET_GLYPH,
  BUCKET_LABEL,
  renderTemplate,
} from "@/lib/templates";

const WEEK_ORDER = ["D1", "W1", "W2", "W3", "W4", "X"];

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

  const canEdit =
    teamMember?.role === "founder" || teamMember?.role === "admin";

  useEffect(() => {
    void load();
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
          },
        ]),
      ),
    );
    setLoading(false);
  }

  async function save(id: string) {
    setError(null);
    setSaving(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const draft = drafts[id];
      const res = await fetch(`/api/admin/templates/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { template } = await res.json();
      setRows((prev) => prev.map((r) => (r.id === id ? template : r)));
      setSavedId(id);
      setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(null);
  }

  function updateDraft(id: string, field: keyof DraftFields, value: string) {
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
      d.body !== t.body
    );
  }

  // Group templates by week for display
  const groupedRows = useMemo(() => {
    const groups: Record<string, Template[]> = {};
    for (const r of rows) {
      const key = r.week ?? "(other)";
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
    <div className="p-8 max-w-5xl">
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "-0.022em",
          color: "var(--color-text-primary)",
          marginBottom: 4,
        }}
      >
        Templates
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-tertiary)",
          marginBottom: 24,
        }}
      >
        The 20 Discord DMs Astrid sends + the 1 admin-only scenario (W2.6).
        Edits land in the <code>templates</code> table and the next task copy
        uses the new text immediately.
      </p>

      {!canEdit && (
        <div
          className="mb-6 p-3 rounded"
          style={{
            background: "rgba(212,162,76,0.10)",
            border: "1px solid rgba(212,162,76,0.30)",
            fontSize: 13,
            color: "var(--color-warning)",
          }}
        >
          You&apos;re signed in as <strong>{teamMember?.role}</strong>. Only
          founder / admin roles can edit templates — viewing is read-only.
        </div>
      )}

      {error && (
        <div
          className="mb-6 p-3 rounded"
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

      <div className="flex flex-col gap-6">
        {groupedRows.map(([weekKey, group]) => (
          <section key={weekKey}>
            <h2
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                marginBottom: 8,
              }}
            >
              {weekKey === "D1"
                ? "Day 1 SOP"
                : weekKey === "X"
                  ? "Cross-week"
                  : `Week ${weekKey.replace("W", "")}`}
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
                        astrid_booking_link:
                          "https://cal.com/astrid/onboarding",
                        program_login_link:
                          "https://sprint.ecomtalent.com/login",
                        karlo_walkthrough_video_link:
                          "https://youtu.be/<walkthrough>",
                      },
                    })
                  : null;
                const glyph = BUCKET_GLYPH[t.bucket] ?? "·";
                const bucketLabel = BUCKET_LABEL[t.bucket] ?? t.bucket;

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
                        style={{
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                          fontSize: 11,
                          color: "var(--color-text-tertiary)",
                          minWidth: 48,
                        }}
                      >
                        {t.scenario_id}
                      </span>
                      <span
                        title={bucketLabel}
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
                        {t.title}
                      </span>
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
                        {/* Read-only meta */}
                        <div
                          className="mt-3 mb-4 grid grid-cols-2 gap-3 text-xs"
                          style={{ color: "var(--color-text-tertiary)" }}
                        >
                          <div>
                            <strong>Bucket:</strong>{" "}
                            <span style={{ color: "var(--color-text-secondary)" }}>
                              {bucketLabel} ({t.bucket})
                            </span>
                          </div>
                          <div>
                            <strong>Week:</strong>{" "}
                            <span style={{ color: "var(--color-text-secondary)" }}>
                              {t.week ?? "(none)"}
                            </span>
                          </div>
                          <div>
                            <strong>Variables:</strong>{" "}
                            <span
                              style={{
                                color: "var(--color-text-secondary)",
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                              }}
                            >
                              {Array.isArray(t.variables) && t.variables.length > 0
                                ? t.variables.map((v) => `{${v}}`).join(" · ")
                                : "(none)"}
                            </span>
                          </div>
                          <div>
                            <strong>Word count:</strong>{" "}
                            <span style={{ color: "var(--color-text-secondary)" }}>
                              {t.word_count ?? "—"}
                            </span>
                          </div>
                        </div>

                        {/* Editable fields */}
                        <Field label="Title">
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={draft.title}
                            onChange={(e) =>
                              updateDraft(t.id, "title", e.target.value)
                            }
                            style={fieldStyle()}
                          />
                        </Field>
                        <Field label="Trigger">
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
                        <Field label="Intent">
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
                        <Field label="Tone">
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={draft.tone}
                            onChange={(e) =>
                              updateDraft(t.id, "tone", e.target.value)
                            }
                            style={fieldStyle()}
                          />
                        </Field>

                        {/* Body — the actual DM */}
                        {!t.is_admin_only && (
                          <Field label="DM body (the text Astrid copies)">
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

                        {/* Preview + Save */}
                        {!t.is_admin_only && (
                          <div className="flex items-start gap-3 mt-3">
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
    </div>
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

