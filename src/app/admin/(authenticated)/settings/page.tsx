"use client";

/**
 * /admin/settings — edit URL config vars used by Astrid's templates.
 *
 * v51 (brief v3): astrid_booking_link + karlo_walkthrough_video_link
 * removed (call branching killed, intro video moved behind the
 * dashboard login). Keys now:
 *
 * - program_login_link    → {programLink}
 * - discord_invite_link   → {discordInvite} (Cohort B NA templates)
 *
 * Founder + admin only — checked server-side on PUT.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import type { AdminConfigRow } from "@/types/database";
import { RestrictedPage } from "@/components/admin/ui";

const FRIENDLY_LABELS: Record<string, string> = {
  program_login_link: "Program login link",
  discord_invite_link: "Discord invite link",
};

export default function AdminSettingsPage() {
  const { teamMember } = useAuth();
  if (teamMember?.role === "csm") {
    return <RestrictedPage title="Settings" />;
  }
  return <AdminSettingsBody />;
}

function AdminSettingsBody() {
  const { teamMember } = useAuth();
  const supabase = createClient();
  const [rows, setRows] = useState<AdminConfigRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
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
    const { data } = await supabase.from("admin_config").select("*").order("key");
    const list = (data as AdminConfigRow[] | null) ?? [];
    setRows(list);
    setDrafts(Object.fromEntries(list.map((r) => [r.key, r.value])));
    setLoading(false);
  }

  async function save(key: string) {
    setError(null);
    setSaving(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key, value: drafts[key] ?? "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { row } = await res.json();
      setRows((prev) => prev.map((r) => (r.key === key ? row : r)));
      setSavedKey(key);
      setTimeout(() => setSavedKey((cur) => (cur === key ? null : cur)), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(null);
  }

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
    <div className="p-8 max-w-3xl">
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "-0.022em",
          color: "var(--color-text-primary)",
          marginBottom: 4,
        }}
      >
        Settings
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-tertiary)",
          marginBottom: 24,
        }}
      >
        URL values inlined into Astrid&apos;s DM templates. Edits are live
        immediately — the next task copied uses the new value.
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
          founder / admin roles can edit these.
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

      <div className="flex flex-col gap-5">
        {rows.map((row) => {
          const friendly = FRIENDLY_LABELS[row.key] ?? row.key;
          const draft = drafts[row.key] ?? "";
          const dirty = draft !== row.value;
          const empty = draft.trim() === "";

          return (
            <div
              key={row.key}
              className="p-4 rounded"
              style={{
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  marginBottom: 2,
                }}
              >
                {friendly}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  marginBottom: 8,
                }}
              >
                {row.key}
              </div>
              {row.description && (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    marginBottom: 8,
                  }}
                >
                  {row.description}
                </p>
              )}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={draft}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [row.key]: e.target.value,
                    }))
                  }
                  placeholder="https://…"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    fontSize: 13,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    color: "var(--color-text-primary)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void save(row.key)}
                  disabled={!canEdit || !dirty || saving === row.key}
                  style={{
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 6,
                    background:
                      dirty && canEdit
                        ? "var(--color-accent)"
                        : "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    color:
                      dirty && canEdit
                        ? "var(--color-text-on-accent, #fff)"
                        : "var(--color-text-tertiary)",
                    cursor: dirty && canEdit ? "pointer" : "not-allowed",
                    opacity: saving === row.key ? 0.6 : 1,
                  }}
                >
                  {saving === row.key
                    ? "Saving…"
                    : savedKey === row.key
                      ? "Saved ✓"
                      : "Save"}
                </button>
              </div>
              {empty && (
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--color-warning)",
                    marginTop: 6,
                  }}
                >
                  ⚠ Empty — templates that reference this will render
                  with the placeholder intact.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
