"use client";

/**
 * /admin/discord — Discord bot test surface.
 *
 * Right now the bot only sends one thing to students: the Day-28 DM.
 * This page lets the team fire that DM at DISCORD_TEST_DM_RECIPIENT
 * (set on Vercel) using any student's real numbers, so we can preview
 * formatting before launch.
 *
 * As we add more bot-driven messages this page grows with one section
 * per message type.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student } from "@/types/database";
import {
  AdminPage,
  PageHeader,
  Section,
  Card,
  Button,
  RestrictedPage,
  T,
} from "@/components/admin/ui";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import type { DmToggleKey } from "@/lib/dm-toggles";
import { useAuth } from "@/contexts/AuthContext";

interface PreviewResponse {
  ok: boolean;
  recipient: string;
  student_name: string | null;
  preview: {
    lessons_done: number;
    total_lessons: number;
    longest_streak: number;
    notes: number;
    discount: string;
  };
}

export default function AdminDiscordPage() {
  const { teamMember } = useAuth();
  if (teamMember?.role === "csm") {
    return <RestrictedPage title="Discord test" />;
  }
  return <AdminDiscordBody />;
}

function AdminDiscordBody() {
  const supabase = createClient();
  const [students, setStudents] = useState<Student[]>([]);
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pull a manageable list of active students — anything past the
  // admin cutoff with a Whop membership.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("students")
        .select("*")
        .not("whop_membership_id", "is", null)
        .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF)
        .order("joined_at", { ascending: false })
        .limit(500);
      if (data) {
        setStudents(data as Student[]);
        if (data.length > 0) setPick((data[0] as Student).id);
      }
    })();
  }, [supabase]);

  const sortedStudents = useMemo(
    () =>
      [...students].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [students],
  );

  async function fire() {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/preview-day28-dm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ studentId: pick }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setResult(json as PreviewResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage>
      <PageHeader
        title="Discord"
        description="Pause / resume every automated Discord send, and fire test DMs to your own ID for formatting preview."
      />

      <DmSettingsSection />

      <Section eyebrow="Day-28 summary DM">
        <Card padding={20}>
          <p style={{ ...T.bodyDim, marginBottom: 16 }}>
            Sends the Day-28 summary embed using the picked student&apos;s
            actual numbers. The DM goes to{" "}
            <strong style={{ color: "var(--color-text-primary)" }}>
              your test Discord ID
            </strong>
            , not the student.
          </p>
          <div
            className="flex items-center gap-2 flex-wrap"
            style={{ marginBottom: 12 }}
          >
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                color: "var(--color-text-primary)",
                minWidth: 280,
                letterSpacing: "-0.005em",
              }}
            >
              {sortedStudents.length === 0 && (
                <option value="">No students yet</option>
              )}
              {sortedStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? "(no name)"} —{" "}
                  {new Date(s.joined_at).toLocaleDateString()}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="md"
              busy={busy}
              onClick={() => void fire()}
              disabled={!pick}
            >
              {busy ? "Firing…" : "Fire test DM →"}
            </Button>
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(200,74,74,0.10)",
                border: "1px solid rgba(200,74,74,0.30)",
                fontSize: 13,
                color: "var(--color-danger)",
              }}
            >
              {error}
            </div>
          )}

          {result && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(46,139,87,0.08)",
                border: "1px solid rgba(46,139,87,0.30)",
                fontSize: 13,
                color: "var(--color-success)",
              }}
            >
              <p style={{ fontWeight: 600, marginBottom: 6 }}>
                ✓ Sent to {result.recipient}
              </p>
              <p style={{ color: "var(--color-text-secondary)" }}>
                Preview values for {result.student_name ?? "this student"}:{" "}
                {result.preview.lessons_done} / {result.preview.total_lessons}{" "}
                lessons · streak {result.preview.longest_streak}d ·{" "}
                {result.preview.notes} notes · discount{" "}
                {result.preview.discount}
              </p>
            </div>
          )}
        </Card>
      </Section>
    </AdminPage>
  );
}

/* ─────────────── DM settings ─────────────── */

interface ToggleRowSpec {
  key: Exclude<DmToggleKey, "dms_master_enabled">;
  title: string;
  description: string;
}

const TOGGLE_ROWS: ToggleRowSpec[] = [
  {
    key: "day28_dm_enabled",
    title: "Day-28 summary DM",
    description:
      "Per-student DM (or team-channel fallback) sent 28 days after join. Cron runs 09:30 UTC.",
  },
  {
    key: "engagement_alerts_enabled",
    title: "Disengagement alerts",
    description:
      "Team-channel embed listing flagged students. Cron runs 09:00 UTC.",
  },
  {
    key: "csm_task_summary_enabled",
    title: "CSM task queue summary",
    description:
      "Team-channel embed with a count of new tasks. Task generation runs regardless — only the public post is gated.",
  },
];

function DmSettingsSection() {
  const [toggles, setToggles] = useState<Record<DmToggleKey, boolean> | null>(
    null,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/dm-toggles", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setToggles(json.toggles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setToggle(key: DmToggleKey, value: boolean) {
    setBusyKey(key);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/dm-toggles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key, value }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setToggles(json.toggles);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  const masterOn = toggles?.dms_master_enabled === true;

  return (
    <Section eyebrow="DM settings">
      <Card padding={20}>
        {/* Big status banner */}
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            marginBottom: 20,
            background: masterOn
              ? "rgba(46,139,87,0.08)"
              : "rgba(200,74,74,0.08)",
            border: `1px solid ${
              masterOn ? "rgba(46,139,87,0.30)" : "rgba(200,74,74,0.30)"
            }`,
          }}
        >
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: masterOn ? "var(--color-success)" : "var(--color-danger)",
              letterSpacing: "-0.005em",
            }}
          >
            {masterOn
              ? "✓ Automated Discord sends are LIVE"
              : "✕ All automated Discord sends are PAUSED"}
          </p>
          <p
            style={{
              ...T.bodyDim,
              fontSize: 12,
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {masterOn
              ? "Per-message toggles below control which crons actually fire. Manual previews from this page are not affected by these switches."
              : "No cron will post to Discord while the master is off, regardless of the per-message switches below. Flip this on once you're in production."}
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(200,74,74,0.10)",
              border: "1px solid rgba(200,74,74,0.30)",
              fontSize: 13,
              color: "var(--color-danger)",
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {/* Master switch row */}
        <ToggleRow
          title="Master switch"
          description="Global kill switch. When off, no automated Discord send happens — full stop."
          checked={masterOn}
          busy={busyKey === "dms_master_enabled"}
          onChange={(v) => void setToggle("dms_master_enabled", v)}
          loading={toggles === null}
        />

        <div
          style={{
            borderTop: "1px solid var(--color-border)",
            margin: "16px 0",
          }}
        />

        {/* Per-message rows */}
        {TOGGLE_ROWS.map((row) => (
          <ToggleRow
            key={row.key}
            title={row.title}
            description={row.description}
            checked={Boolean(toggles?.[row.key])}
            busy={busyKey === row.key}
            onChange={(v) => void setToggle(row.key, v)}
            disabled={!masterOn}
            loading={toggles === null}
          />
        ))}
      </Card>
    </Section>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  busy,
  onChange,
  disabled = false,
  loading = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4"
      style={{ padding: "10px 0", opacity: disabled ? 0.45 : 1 }}
    >
      <div className="flex-1 min-w-0">
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.011em",
          }}
        >
          {title}
        </p>
        <p style={{ ...T.bodyDim, fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled || busy || loading}
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 26,
          borderRadius: 13,
          border: "none",
          cursor: disabled || busy || loading ? "default" : "pointer",
          background: checked
            ? "var(--color-success)"
            : "rgba(20,20,24,0.18)",
          position: "relative",
          transition: "background 200ms var(--ease-default)",
          flexShrink: 0,
          padding: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#FFFFFF",
            boxShadow: "0 1px 2px rgba(20,20,24,0.18)",
            transition: "left 200ms var(--ease-default)",
          }}
        />
      </button>
    </div>
  );
}
