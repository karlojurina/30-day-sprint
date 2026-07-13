"use client";

/**
 * /admin/tasks/insights — Outreach insights (v85.2).
 *
 * The Phase 0 measurement surface: does our outreach move behavior,
 * and which templates do the moving? Everything here is computed by
 * src/lib/outreach-insights.ts (shared with the /admin/templates
 * strip) — definitions live in the methodology box at the bottom.
 *
 * Headline metric: REVIVAL RATE — of DMs sent to dormant students
 * (zero activity in the 72h before the send), how many were active
 * within 72h after. Plain re-engagement is kept as a secondary
 * column but is inflated by already-active students.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { OutreachInsights, TemplateInsightRow } from "@/lib/outreach-insights";
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

type SortKey =
  | "title"
  | "sent"
  | "time"
  | "revival"
  | "reengaged"
  | "replied"
  | "dismissed";

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

  const fetchInsights = useCallback(async () => {
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
      setData((await res.json()) as OutreachInsights);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
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
        case "revival":
          return r.revival_eligible > 0 ? r.revived / r.revival_eligible : -1;
        case "reengaged":
          return r.sent > 0 ? r.re_engaged_72h / r.sent : -1;
        case "replied": {
          const marked = r.replied + r.no_reply;
          return marked > 0 ? r.replied / marked : -1;
        }
        case "dismissed":
          return r.dismissed;
      }
    };
    return [...data.templates].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va < vb) return sort.dir;
      if (va > vb) return -sort.dir;
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
  const markedTotal = (totals?.replied ?? 0) + (totals?.no_reply ?? 0);

  return (
    <AdminPage>
      <PageHeader
        title="Outreach insights"
        description="Which DMs move behavior. Revival rate is the honest number — see how everything is calculated at the bottom."
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

      {loading || !totals ? (
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
      ) : (
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
              label="Tasks created"
              value={totals.created}
              sublabel={`${totals.open} open now`}
            />
            <Stat label="DMs sent" value={totals.sent} />
            <Stat
              label="Median task → send"
              value={humanizeMs(totals.median_time_to_send_ms)}
              sublabel="queue latency, not copy quality"
            />
            <Stat
              label="Revival rate"
              value={pct(totals.revived, totals.revival_eligible)}
              sublabel={`${totals.revived} of ${totals.revival_eligible} dormant sends`}
              tone="accent"
            />
            <Stat
              label="Replied"
              value={pct(totals.replied, markedTotal)}
              sublabel={
                markedTotal === 0
                  ? "no outcomes marked yet"
                  : `of ${markedTotal} marked`
              }
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
                            ["revival", "Revival", "right"],
                            ["reengaged", "Re-engaged", "right"],
                            ["replied", "Replied", "right"],
                            ["dismissed", "Dismissed", "right"],
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
                              borderBottom:
                                "1px solid var(--color-border)",
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
                              borderBottom:
                                "1px solid var(--color-border)",
                            }}
                          >
                            <td
                              style={{
                                padding: "10px 16px",
                                maxWidth: 320,
                              }}
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
                            </td>
                            <td style={cellRight}>{r.sent}</td>
                            <td style={cellRight}>
                              {humanizeMs(r.median_time_to_send_ms)}
                            </td>
                            <td
                              style={cellRight}
                              title={`${r.revived} revived of ${r.revival_eligible} sends to dormant students`}
                            >
                              {pct(r.revived, r.revival_eligible)}
                              {r.revival_eligible > 0 && (
                                <span style={subNum}>
                                  {" "}
                                  {r.revived}/{r.revival_eligible}
                                </span>
                              )}
                            </td>
                            <td
                              style={cellRight}
                              title={`${r.re_engaged_72h} of ${r.sent} sends had any activity within 72h after (includes already-active students)`}
                            >
                              {pct(r.re_engaged_72h, r.sent)}
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
                            <td style={cellRight}>
                              {r.dismissed}
                              {r.dismissed_auto > 0 && (
                                <span style={subNum}>
                                  {" "}
                                  ({r.dismissed_auto} auto)
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
                  <strong>Activity</strong> = the student marked a lesson
                  watched, shipped an action item, or wrote/edited a daily
                  note. Nothing else counts (logins alone are invisible to
                  us historically).
                </li>
                <li>
                  <strong>Revival rate</strong> — the headline. Only DMs
                  sent to <em>dormant</em> students count (zero activity in
                  the 72h before the send). Revived = the student had
                  activity within 72h after. This is the closest thing we
                  have to &quot;the message woke them up.&quot;
                </li>
                <li>
                  <strong>Re-engaged</strong> — any activity within 72h
                  after the send, including students who were already
                  active. Inflated by design; kept for continuity with the
                  strip on /admin/templates.
                </li>
                <li>
                  <strong>Replied</strong> — manual Replied / No reply taps
                  on the Sent tab. Only as accurate as the team&apos;s
                  tapping. Unmarked sends are excluded from the rate.
                </li>
                <li>
                  <strong>Time → send</strong> — median gap between the
                  task appearing in the queue and the CSM marking it sent.
                  Measures our process, not the copy.
                </li>
                <li>
                  <strong>Send time</strong> = the moment the CSM clicked
                  &quot;Mark sent,&quot; which is only as precise as the
                  team&apos;s habit of marking right after sending.
                </li>
                <li>
                  Admin-only tasks (discount reviews) and tasks whose
                  template was deleted are excluded from every number
                  above.
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
};

const subNum: CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-tertiary)",
};
