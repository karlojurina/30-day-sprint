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

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student } from "@/types/database";
import {
  AdminPage,
  PageHeader,
  Section,
  Card,
  Button,
  T,
} from "@/components/admin/ui";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";

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
        title="Discord test"
        description="Fire test DMs to DISCORD_TEST_DM_RECIPIENT (set on Vercel). Lets us preview embed formatting without waiting for the real trigger."
      />

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
