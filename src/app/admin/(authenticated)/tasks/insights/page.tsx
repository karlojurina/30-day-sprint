"use client";

/**
 * /admin/tasks/insights — Outreach insights (v85.3).
 *
 * The Phase 0 measurement surface: does our outreach move behavior,
 * and which templates do the moving? Everything here is computed by
 * src/lib/outreach-insights.ts (shared with the /admin/templates
 * strip) — definitions live in the methodology box at the bottom.
 *
 * v85.3 — per-family SUCCESS grading (Karlo's call): each template is
 * graded on what its message asks for. Stalled → logged in. Zero
 * lessons → started a lesson. No-ship → shipped an action. Pace →
 * came back (dormant sends only). Canceling → still subscribed with
 * the cancel withdrawn. Events → not graded. The old revival /
 * re-engaged pair and the dismissed column are gone from display.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type {
  OutreachInsights,
  TemplateInsightRow,
} from "@/lib/outreach-insights";
import { stripBucketGlyph } from "@/lib/templates";
import {
  AdminPage,
  PageHeader,
  Section,
  Card,
  Stat,
  Tabs,
  EmptyState,
  T,
} from "@/components/admin/ui";

type RangeKey = "30d" | "all";

type SortKey = "title" | "sent" | "time" | "success" | "replied";

function bucketDot(b?: string | null) {
  if (b === "at_risk") return "var(--color-warning)";
  if (b === "cancel_path") return "var(--color-danger)";
  if (b === "crushing") return "var(--color-accent-dark)";
  if (b === "event") return "var(--color-text-secondary)";
  return "var(--color-text-tertiary)";
}

function humanizeMs(ms: number | null): string {
  if (ms === null) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function pct(numer: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((numer / denom) * 100)}%`;
}

export default function OutreachInsightsPage() {
  const supabase = createClient();
  const router = useRouter();

  const [data, setData] = useState<OutreachInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30d");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "sent",
    dir: -1,
  });

  // Monotonic fetch counter — a slow all-time response resolving
  // after a fast 30d one must not overwrite it (range-flip race).
  const fetchSeqRef = useRef(0);

  const fetchInsights = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const params = new URLSearchParams();
      if (range === "30d") {
        params.set(
          "since",
          new Date(Date.now() - 30 * 86_400_000).toISOString(),
        );
      }
      const qs = params.toString();
      const res = await fetch(
        `/api/admin/tasks/insights${qs ? `?${qs}` : ""}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as OutreachInsights;
      if (seq !== fetchSeqRef.current) return; // stale response
      setData(payload);
    } catch (e) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
    if (seq === fetchSeqRef.current) setLoading(false);
  }, [range, supabase]);

  useEffect(() => {
    void fetchInsights();
  }, [fetchInsights]);

  const rows = useMemo(() => {
    if (!data) return [];
    const value = (r: TemplateInsightRow): number | string => {
      switch (sort.key) {
        case "title":
          return (r.title ?? "").toLowerCase();
        case "sent":
          return r.sent;
        case "time":
          return r.median_time_to_send_ms ?? -1;
        case "success":
          return r.success_eligible > 0 ? r.success / r.success_eligible : -1;
        case "replied": {
          const marked = r.replied + r.no_reply;
          return marked > 0 ? r.replied / marked : -1;
        }
      }
    };
    // dir -1 = descending (largest first) — matches the ↓ arrow. The
    // -1 no-data sentinels sink to the bottom of the default view.
    return [...data.templates].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [data, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === -1 ? 1 : -1 }
        : { key, dir: -1 },
    );

  const totals = data?.totals;

  return (
    <AdminPage>
      <PageHeader
        title="Outreach insights"
        description="Every template graded on what its message actually asks for. Definitions at the bottom."
        actions={
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            style={{
              padding: "8px 12px",
              fontSize: 13,
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              color: "var(--color-text-primary)",
              outline: "none",
              letterSpacing: "-0.005em",
            }}
          >
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        }
      />

      <div style={{ marginBottom: 24 }}>
        <Tabs
          value="insights"
          onChange={(v) => {
            if (v === "queue") router.push("/admin/tasks");
          }}
          tabs={[
            { value: "queue", label: "Queue" },
            { value: "insights", label: "Insights" },
          ]}
        />
      </div>

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

      {loading ? (
        <div
          className="flex items-center justify-center"
          style={{ padding: 64 }}
        >
          <div
            className="rounded-full animate-spin"
            style={{
              width: 22,
              height: 22,
              border: "2px solid var(--color-accent-dark)",
              borderTopColor: "transparent",
            }}
          />
        </div>
      ) : !totals ? null : ( // failed fetch: error banner above, no spinner
        <>
          {/* KPI row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <Stat
              label="Students reached"
              value={totals.students_reached}
              sublabel="got at least 1 DM"
            />
            <Stat label="DMs sent" value={totals.sent} />
            <Stat
              label="Median task → send"
              value={humanizeMs(totals.median_time_to_send_ms)}
              sublabel="queue latency, not copy quality"
            />
            <Stat
              label="Saves"
              value={pct(totals.saves, totals.saves_eligible)}
              sublabel={
                totals.saves_eligible === 0
                  ? "no save DMs sent in range"
                  : `${totals.saves} of ${totals.saves_eligible} save DMs — still subscribed`
              }
              tone={totals.saves_eligible > 0 ? "accent" : "default"}
            />
            <Stat
              label="Success rate"
              value={pct(totals.success, totals.success_eligible)}
              sublabel={
                totals.success_eligible === 0
                  ? "no graded sends in range"
                  : `${totals.success} of ${totals.success_eligible} graded sends did the thing`
              }
              tone={totals.success_eligible > 0 ? "accent" : "default"}
            />
          </div>

          {/* Data-hygiene nudge — replied numbers are only as good as
              the team's tapping discipline. */}
          {totals.unmarked > 0 && (
            <p style={{ ...T.meta, marginBottom: 24 }}>
              {totals.unmarked} sent DM{totals.unmarked === 1 ? "" : "s"} have
              no outcome marked yet — grade them with Replied / No reply on
              the{" "}
              <a
                href="/admin/tasks"
                style={{
                  color: "var(--color-accent-dark)",
                  textDecoration: "underline",
                }}
              >
                Sent tab
              </a>
              .
            </p>
          )}

          <Section eyebrow="Template performance" count={rows.length}>
            {rows.length === 0 ? (
              <Card>
                <EmptyState
                  title="No outreach in this range."
                  description="DM tasks marked sent will show up here, graded by what the student did next."
                />
              </Card>
            ) : (
              <Card padding={0}>
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <thead>
                      <tr>
                        {(
                          [
                            ["title", "Template", "left"],
                            ["sent", "Sent", "right"],
                            ["time", "Time → send", "right"],
                            ["success", "Success", "right"],
                            ["replied", "Replied", "right"],
                          ] as Array<[SortKey, string, "left" | "right"]>
                        ).map(([key, label, align]) => (
                          <th
                            key={key}
                            onClick={() => toggleSort(key)}
                            style={{
                              ...T.eyebrow,
                              textAlign: align,
                              padding: "12px 16px",
                              cursor: "pointer",
                              userSelect: "none",
                              whiteSpace: "nowrap",
                              borderBottom: "1px solid var(--color-border)",
                            }}
                            title="Click to sort"
                          >
                            {label}
                            {sort.key === key
                              ? sort.dir === -1
                                ? " ↓"
                                : " ↑"
                              : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const marked = r.replied + r.no_reply;
                        return (
                          <tr
                            key={r.template_id}
                            style={{
                              borderBottom: "1px solid var(--color-border)",
                            }}
                          >
                            <td
                              style={{ padding: "10px 16px", maxWidth: 340 }}
                            >
                              <span
                                className="flex items-center gap-2"
                                style={{ minWidth: 0 }}
                              >
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background: bucketDot(r.bucket),
                                    flexShrink: 0,
                                  }}
                                />
                                <span
                                  className="truncate"
                                  style={{
                                    color: "var(--color-text-primary)",
                                    fontWeight: 500,
                                  }}
                                  title={r.scenario_id ?? undefined}
                                >
                                  {r.title
                                    ? stripBucketGlyph(r.title)
                                    : (r.scenario_id ?? "(deleted template)")}
                                </span>
                              </span>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 11,
                                  color: "var(--color-text-tertiary)",
                                  marginTop: 2,
                                  paddingLeft: 14,
                                }}
                              >
                                success = {r.success_label}
                              </span>
                            </td>
                            <td style={cellRight}>{r.sent}</td>
                            <td style={cellRight}>
                              {humanizeMs(r.median_time_to_send_ms)}
                            </td>
                            <td
                              style={cellRight}
                              title={
                                r.family === "event"
                                  ? "Event templates aren't graded"
                                  : `${r.success} of ${r.success_eligible} eligible sends · ${r.success_label}`
                              }
                            >
                              {pct(r.success, r.success_eligible)}
                              {r.success_eligible > 0 && (
                                <span style={subNum}>
                                  {" "}
                                  {r.success}/{r.success_eligible}
                                </span>
                              )}
                            </td>
                            <td
                              style={cellRight}
                              title={`${r.replied} replied · ${r.no_reply} no reply · ${r.unmarked} unmarked`}
                            >
                              {pct(r.replied, marked)}
                              {r.unmarked > 0 && (
                                <span style={subNum}>
                                  {" "}
                                  {r.unmarked} unmarked
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </Section>

          <Section eyebrow="How these numbers work">
            <Card>
              <ul
                style={{
                  ...T.bodyDim,
                  fontSize: 13,
                  lineHeight: 1.7,
                  paddingLeft: 18,
                  margin: 0,
                  listStyle: "disc",
                }}
              >
                <li>
                  <strong>Success is graded per template family</strong> — on
                  the thing the message actually asks for. Stalled DMs:
                  logged in within 72h of the send. Zero-lessons DMs:
                  started a lesson within 72h. No-ship DMs: shipped an
                  action item within 72h (watching more lessons does NOT
                  count). Behind-pace DMs: lesson or note activity within
                  72h, counted only for sends to students who were dormant
                  in the 72h before (so already-active students can&apos;t
                  inflate it). Each row shows its own definition.
                </li>
                <li>
                  <strong>Saves</strong> (canceling DMs) = the student is
                  active today with the cancel withdrawn. We don&apos;t
                  store cancel history yet, so this is a current-state
                  check — it can&apos;t prove the un-cancel happened after
                  the DM. Treat it as a strong signal, not a timestamped
                  fact.
                </li>
                <li>
                  <strong>Replied</strong> — manual Replied / No reply taps
                  on the Sent tab. Only as accurate as the team&apos;s
                  tapping; unmarked sends are excluded from the rate.
                  Matters most for save conversations.
                </li>
                <li>
                  <strong>Time → send</strong> — median gap between the task
                  appearing in the queue and the CSM marking it sent.
                  Measures our process, not the copy. Send time = the
                  moment &quot;Mark sent&quot; was clicked.
                </li>
                <li>
                  <strong>Students reached</strong> counts unique students,
                  so the escalation ladder (day 3 → 5 → 7) doesn&apos;t
                  inflate it the way raw task counts would.
                </li>
                <li>
                  Welcome, month-2 and celebration templates aren&apos;t
                  graded (&quot;—&quot;). Admin-only tasks (discount
                  reviews) and tasks whose template was deleted are
                  excluded from every number.
                </li>
                <li>
                  Canceling templates carry their saves in their own
                  Success column, while the Success-rate KPI pools only
                  the other families (Saves has its own tile) — so the
                  column doesn&apos;t sum to the KPI, by design.
                </li>
                <li>
                  All of this is <strong>correlation, not causation</strong>
                  {" "}— students also come back on their own. Use these
                  numbers to rank templates against each other, not as
                  absolute proof a DM worked.
                </li>
              </ul>
            </Card>
          </Section>
        </>
      )}
    </AdminPage>
  );
}

const cellRight: CSSProperties = {
  padding: "10px 16px",
  textAlign: "right",
  whiteSpace: "nowrap",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
};

const subNum: CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-tertiary)",
};
