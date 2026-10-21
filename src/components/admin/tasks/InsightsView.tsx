"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, EmptyState, Stat, T } from "@/components/admin/ui";
import { ListHeader, ListPage, LoadError, SkeletonRows, TAP, pressPill } from "@/components/admin/list-parts";
import { TextLink } from "@/components/admin/review-parts";
import type { Answer } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import { insightsTransport, type InsightsTransport } from "@/lib/admin/people-transport";
import { insightsRanges, type InsightsRange } from "@/lib/admin/tasks-view";
import type { OutreachInsights, TemplateInsightRow } from "@/lib/outreach-insights";
import { stripBucketGlyph } from "@/lib/templates";

/**
 * Outreach insights, /admin/tasks/insights (v85.3; admin rebuild 2, D7 and
 * D12), in the brand kit's dark look: does the outreach move students, and
 * which templates do the moving. Everything is computed by
 * src/lib/outreach-insights.ts behind GET /api/admin/tasks/insights.
 *
 * Since the tasks reset (v109) the route counts only the tasks made on or
 * after it, as the queue lists them, so "All time" reads "Since the reset"
 * then, and while the reset is under 30 days old it is the one range
 * (insightsRanges). A save is a student who is still a member with the
 * cancel withdrawn.
 *
 * The review's fix round: "Queue" is a text link back to Tasks (the pills
 * that linked the two looked like the status tabs); how the numbers work is
 * folded under one line, as on Insights; and under 640px each template is a
 * card (its name and success rule, then Sent, Time to send, Success and
 * Replied in a 2 by 2 grid) where the table would scroll sideways.
 */

type SortKey = "title" | "sent" | "time" | "success" | "replied";
type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: OutreachInsights };

const DAY_MS = 86_400_000;

function bucketDot(b?: string | null) {
  if (b === "at_risk") return "var(--color-warning)";
  if (b === "cancel_path") return "var(--color-danger)";
  if (b === "crushing") return "var(--color-accent-dark)";
  return "var(--color-neutral)";
}

/** "40 min", "5 h", "1.5 days"; "None" when nothing was sent. */
function humanizeMs(ms: number | null): string {
  if (ms === null) return "None";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

/** A share in whole percent; "None" with nothing to share. */
function pct(numer: number, denom: number): string {
  if (denom === 0) return "None";
  return `${Math.round((numer / denom) * 100)}%`;
}

const COLUMNS: Array<[SortKey, string, "left" | "right"]> = [
  ["title", "Template", "left"],
  ["sent", "Sent", "right"],
  ["time", "Time to send", "right"],
  ["success", "Success", "right"],
  ["replied", "Replied", "right"],
];

export function InsightsView({ transport = insightsTransport }: { transport?: InsightsTransport }) {
  const [range, setRange] = useState<InsightsRange>("30d");
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [floor, setFloor] = useState<string | null>(null);
  /** When the last answer that worked was worked out (its computed_at): the ranges are judged at that moment. */
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "sent", dir: -1 });
  const seq = useRef(0);

  /** One read. Null when a newer read started meanwhile (a slow "since the reset" must not land over a quick 30 days). */
  const fetchInsights = useCallback(
    async (r: InsightsRange): Promise<Answer<OutreachInsights> | null> => {
      const mine = ++seq.current;
      const since = r === "30d" ? new Date(Date.now() - 30 * DAY_MS).toISOString() : null;
      const answer = await transport.loadInsights(since);
      return mine === seq.current ? answer : null;
    },
    [transport],
  );

  const apply = useCallback((r: Answer<OutreachInsights>) => {
    setLoaded(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
    if (r.ok) {
      setFloor(r.data.tasks_floor ?? null);
      setComputedAt(r.data.computed_at);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchInsights(range).then((r) => {
      if (alive && r) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchInsights, apply, range]);

  async function retry() {
    setBusy(true);
    const r = await fetchInsights(range);
    setBusy(false);
    if (r) apply(r);
  }

  function choose(r: InsightsRange) {
    if (r === range) return;
    setLoaded({ kind: "loading" });
    setRange(r);
  }

  // While the reset is under 30 days old, "Since the reset" is the one range: no choice to show. Counted from
  // the moment the last answer was worked out (its computed_at), so the page and its dev page agree; before the
  // first answer the reset is unknown, so no range shows yet.
  const offered = computedAt ? insightsRanges(floor, Date.parse(computedAt)) : [];
  const ranges =
    offered.length > 1 ? (
      <div role="group" aria-label="Range" className="flex flex-wrap" style={{ gap: 8, marginBottom: 16 }}>
        {offered.map((r) => (
          <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => choose(r.value)} style={pressPill(range === r.value)}>
            {r.label}
          </button>
        ))}
      </div>
    ) : null;
  const top = (meta: React.ReactNode) => (
    <>
      <TextLink href="/admin/tasks">
        <span aria-hidden="true">←</span> Queue
      </TextLink>
      <ListHeader
        title="Outreach insights"
        description="Every template graded on what its message asks for. How each number works is at the bottom."
        meta={meta}
      />
      {ranges}
    </>
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {top("Loading")}
        <SkeletonRows rows={3} label="Loading the insights" />
      </ListPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <ListPage>
        {top(null)}
        <LoadError title="Couldn't load the insights." detail={loaded.error} onRetry={() => void retry()} busy={busy} />
      </ListPage>
    );
  }

  const data = loaded.data;
  const totals = data.totals;
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
  const rows = [...data.templates].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va < vb) return -sort.dir;
    if (va > vb) return sort.dir;
    return 0;
  });
  const toggle = (key: SortKey) => setSort((p) => (p.key === key ? { key, dir: p.dir === -1 ? 1 : -1 } : { key, dir: -1 }));

  return (
    <ListPage>
      {top(
        `Updated ${clockLabel(data.computed_at)}${
          data.tasks_floor ? ` · Counts the tasks made since the reset on ${dayLabel(data.tasks_floor)}; older ones are on the Archived tab of Tasks` : ""
        }`,
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
        <Stat label="Students reached" value={totals.students_reached} sublabel="got at least 1 DM" />
        <Stat label="DMs sent" value={totals.sent} />
        <Stat label="Time to send" value={humanizeMs(totals.median_time_to_send_ms)} sublabel="the middle wait, from task to sent" />
        <Stat
          label="Saves"
          value={pct(totals.saves, totals.saves_eligible)}
          sublabel={
            totals.saves_eligible === 0
              ? "no save DMs sent in this range"
              : `${totals.saves} of ${totals.saves_eligible} save DMs: still a member`
          }
          tone={totals.saves_eligible > 0 ? "accent" : "default"}
        />
        <Stat
          label="Success rate"
          value={pct(totals.success, totals.success_eligible)}
          sublabel={
            totals.success_eligible === 0
              ? "no graded sends in this range"
              : `${totals.success} of ${totals.success_eligible} graded sends did what the DM asked`
          }
          tone={totals.success_eligible > 0 ? "accent" : "default"}
        />
      </div>

      {totals.graded_on_old_course > 0 && (
        <p style={{ ...T.bodyDim, fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
          {totals.graded_on_old_course === 1 ? "1 DM was" : `${totals.graded_on_old_course} DMs were`} sent before the course
          switch{data.reset_at ? ` (${dayLabel(data.reset_at)})` : ""}, so Success leaves{" "}
          {totals.graded_on_old_course === 1 ? "it" : "them"} out. They still count as sent. Save DMs are graded as before.
        </p>
      )}
      {totals.unmarked > 0 && (
        <p style={{ ...T.bodyDim, fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
          {totals.unmarked} sent {totals.unmarked === 1 ? "DM has" : "DMs have"} no reply marked yet. Mark Replied or No reply on the
          Sent tab of Tasks.
        </p>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2 className="flex items-baseline" style={{ gap: 8, marginBottom: 8 }}>
          <span style={{ ...T.eyebrow, fontSize: 12 }}>Template performance</span>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{rows.length}</span>
        </h2>
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              title="No outreach in this range."
              description="DM tasks marked sent show here, graded by what the student did next."
            />
          </Card>
        ) : (
          <Card padding={0}>
            {/* Under 640px: a card per template, where the table would scroll sideways. */}
            <ul className="sm:hidden" aria-label="Templates">
              {rows.map((r) => {
                const marked = r.replied + r.no_reply;
                return (
                  <li key={r.template_id} className="list-row" data-template-card="" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, padding: 16 }}>
                    <div>
                      <span className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
                        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: bucketDot(r.bucket), flexShrink: 0 }} />
                        <span style={{ ...T.body, fontWeight: 600, overflowWrap: "anywhere" }}>
                          {r.title ? stripBucketGlyph(r.title) : (r.scenario_id ?? "A deleted template")}
                        </span>
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, paddingLeft: 14 }}>
                        success = {r.success_label}
                        {r.graded_on_old_course > 0 && ` · ${r.graded_on_old_course} graded on the old course`}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2" style={{ gap: "10px 12px", fontVariantNumeric: "tabular-nums" }}>
                      <CardNumber label="Sent" value={String(r.sent)} />
                      <CardNumber label="Time to send" value={humanizeMs(r.median_time_to_send_ms)} />
                      <CardNumber
                        label="Success"
                        value={r.family === "event" ? "Not graded" : pct(r.success, r.success_eligible)}
                        sub={r.success_eligible > 0 ? `${r.success} of ${r.success_eligible}` : undefined}
                      />
                      <CardNumber label="Replied" value={pct(r.replied, marked)} sub={r.unmarked > 0 ? `${r.unmarked} unmarked` : undefined} />
                    </dl>
                  </li>
                );
              })}
            </ul>
            <div className="hidden sm:block" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr>
                    {COLUMNS.map(([key, label, align]) => (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={sort.key === key ? (sort.dir === -1 ? "descending" : "ascending") : "none"}
                        style={{ textAlign: align, padding: "0 12px", borderBottom: "1px solid var(--color-border)" }}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          style={{
                            minHeight: TAP,
                            padding: "0 4px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            color: sort.key === key ? "var(--color-accent-dark)" : "var(--color-text-secondary)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                          {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const marked = r.replied + r.no_reply;
                    return (
                      <tr key={r.template_id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td style={{ padding: "10px 16px", maxWidth: 360, verticalAlign: "top" }}>
                          <span className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
                            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: bucketDot(r.bucket), flexShrink: 0 }} />
                            <span style={{ color: "var(--color-text-primary)", fontWeight: 500, overflowWrap: "anywhere" }}>
                              {r.title ? stripBucketGlyph(r.title) : (r.scenario_id ?? "A deleted template")}
                            </span>
                          </span>
                          <span style={{ display: "block", fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, paddingLeft: 14 }}>
                            success = {r.success_label}
                            {r.graded_on_old_course > 0 && ` · ${r.graded_on_old_course} graded on the old course`}
                          </span>
                        </td>
                        <td style={cellRight}>{r.sent}</td>
                        <td style={cellRight}>{humanizeMs(r.median_time_to_send_ms)}</td>
                        <td style={cellRight}>
                          {r.family === "event" ? "Not graded" : pct(r.success, r.success_eligible)}
                          {r.success_eligible > 0 && <span style={subNum}> {r.success}/{r.success_eligible}</span>}
                        </td>
                        <td style={cellRight}>
                          {pct(r.replied, marked)}
                          {r.unmarked > 0 && <span style={subNum}> {r.unmarked} unmarked</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <details style={{ marginTop: 8 }}>
        <summary style={{ ...T.body, fontWeight: 600, minHeight: TAP, display: "flex", alignItems: "center", cursor: "pointer", color: "var(--color-text-secondary)" }}>
          How these numbers work
        </summary>
        <Card>
          <ul style={{ ...T.bodyDim, lineHeight: 1.7, paddingLeft: 18, margin: 0, listStyle: "disc" }}>
            <li>
              <strong style={{ color: "var(--color-text-primary)" }}>Success is graded per template family</strong>, on the thing
              its message asks for. Stalled DMs: logged in within 72 hours of the send. Zero lessons DMs: started a lesson within
              72 hours. No-ship DMs: shipped an action item within 72 hours (watching more lessons does not count). Behind pace
              DMs: lesson or note activity within 72 hours, counted only for students who were quiet in the 72 hours before, so
              students who were already active cannot inflate it. Each row shows its own definition.
            </li>
            <li>
              <strong style={{ color: "var(--color-text-primary)" }}>Saves</strong> (canceling DMs): the student is still a member
              today with the cancel withdrawn. There is no history of cancels yet, so this reads the membership as it is now and
              cannot prove the change came after the DM. Read it as a strong signal, not a dated fact.
            </li>
            <li>
              <strong style={{ color: "var(--color-text-primary)" }}>Replied</strong>: the team&apos;s Replied and No reply on the
              Sent tab. Only as good as the marking; a send with neither is left out of the rate.
            </li>
            <li>
              <strong style={{ color: "var(--color-text-primary)" }}>Time to send</strong>: the middle wait between a task
              appearing and the team marking it sent. It measures the team&apos;s pace, not the words of the DM.
            </li>
            <li>
              <strong style={{ color: "var(--color-text-primary)" }}>Students reached</strong> counts each student once, so the
              ladder of day 3, 5 and 7 DMs does not inflate it.
            </li>
            <li>
              Welcome, month 2 and celebration templates are not graded. Tasks for the 30% review (no DM) and tasks whose
              template was deleted are left out of every number.
            </li>
            {data.tasks_floor && (
              <li>
                <strong style={{ color: "var(--color-text-primary)" }}>The tasks reset</strong> on {dayLabel(data.tasks_floor)}{" "}
                started the queue fresh for the new program. Only the tasks made since then are counted here; the older ones are
                kept on the Archived tab of Tasks.
              </li>
            )}
            {data.reset_at && (
              <li>
                <strong style={{ color: "var(--color-text-primary)" }}>The course switch</strong>{" "}archived the old course&apos;s
                progress. A stalled, zero lessons, no-ship, behind pace or custom DM sent before it is left out of Success,
                because what it was graded on is gone. It still counts as sent. Save DMs read the membership, which the switch
                left alone, so they are graded as before.
              </li>
            )}
            <li>
              Canceling templates carry their saves in their own Success column, while the Success rate pools only the other
              families (Saves has its own tile), so the column does not add up to the rate, on purpose.
            </li>
            <li>
              All of this is <strong style={{ color: "var(--color-text-primary)" }}>correlation, not causation</strong>: students
              also come back on their own. Use these numbers to rank templates against each other, not as proof a DM worked.
            </li>
          </ul>
        </Card>
      </details>
    </ListPage>
  );
}

/** One number of a template's card on a phone: its name over it, and a smaller line under it when there is one. */
function CardNumber({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ ...T.eyebrow, fontSize: 11 }}>{label}</dt>
      <dd style={{ marginTop: 2, fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {value}
        {sub && <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--color-text-secondary)" }}>{sub}</span>}
      </dd>
    </div>
  );
}

const cellRight: React.CSSProperties = {
  padding: "10px 16px",
  textAlign: "right",
  whiteSpace: "nowrap",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
};

const subNum: React.CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-secondary)",
};
