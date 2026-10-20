"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Pill, Stat, T } from "@/components/admin/ui";
import type { PillTone } from "@/components/admin/ui";
import { CopyButton, ListPage, LoadError, MembershipPill, SkeletonRows, TAP } from "@/components/admin/list-parts";
import { ActivityPill, Dot, FactsLine, Meter, Warning } from "@/components/admin/people-parts";
import type { Answer } from "@/lib/admin/admin-transport";
import { dayLabel, dayTimeLabel } from "@/lib/admin/croatia-dates";
import { agoText, type Read } from "@/lib/admin/people-common";
import { peopleTransport, type PeopleTransport } from "@/lib/admin/people-transport";
import type { StudentDetail, SyncView } from "@/lib/admin/student-detail";

/**
 * One student, /admin/students/[id] (admin rebuild 2, D9), in the brand
 * kit's dark look. The reads and the rules are in
 * src/lib/admin/student-detail.ts; this file shows them.
 *
 * Each block whose read failed says "Couldn't load", never 0%, 0 days or
 * "No application submitted"; the student's own read failing is the page's
 * error, with Retry, and an id with no student says so. The Whop sync block
 * says "Not synced since the switch" when its numbers are the old course's
 * (whopPulled, as the 30% page marks it). No plan anywhere.
 *
 * The quick DMs keep their words as they were; the messages draft of admin
 * rebuild 2 (WI-10) rewrites them.
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "missing" }
  | { kind: "ready"; data: StudentDetail };

export const COULD_NOT_LOAD = "Couldn't load";

/** The latest 30% request's pill colour, in the 30% page's words. */
const DISCOUNT_TONE: Record<string, PillTone> = {
  pending: "warning",
  approved: "success",
  applied: "neutral",
  rejected: "danger",
};

/** Loads one student through `transport`, for the page and the journey's drawer. */
export function useStudent(transport: PeopleTransport, studentId: string) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const fetchOne = useCallback(async (): Promise<Answer<StudentDetail | null> | null> => {
    const mine = ++seq.current;
    const r = await transport.loadStudent(studentId);
    return mine === seq.current ? r : null;
  }, [transport, studentId]);

  const apply = useCallback((r: Answer<StudentDetail | null>) => {
    setLoaded(!r.ok ? { kind: "error", error: r.error } : r.data ? { kind: "ready", data: r.data } : { kind: "missing" });
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchOne().then((r) => {
      if (alive && r) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchOne, apply]);

  const retry = useCallback(async () => {
    setBusy(true);
    const r = await fetchOne();
    setBusy(false);
    if (r) apply(r);
  }, [fetchOne, apply]);

  /** A change saved: the page shows it at once. */
  const patch = useCallback((change: Partial<StudentDetail>) => {
    setLoaded((cur) => (cur.kind === "ready" ? { kind: "ready", data: { ...cur.data, ...change } } : cur));
  }, []);

  return { loaded, busy, retry, patch };
}

export function StudentDetailView({ studentId, transport = peopleTransport }: { studentId: string; transport?: PeopleTransport }) {
  const { loaded, busy, retry, patch } = useStudent(transport, studentId);

  const back = (
    <Link
      href="/admin/students"
      style={{ display: "inline-flex", alignItems: "center", minHeight: TAP, color: "var(--color-accent-dark)", fontSize: 13, fontWeight: 600, marginBottom: 8 }}
    >
      All students
    </Link>
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {back}
        <SkeletonRows rows={3} label="Loading the student" />
      </ListPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <ListPage>
        {back}
        <LoadError title="Couldn't load this student." detail={loaded.error} onRetry={() => void retry()} busy={busy} />
      </ListPage>
    );
  }
  if (loaded.kind === "missing") {
    return (
      <ListPage>
        {back}
        <Card padding={20}>
          <p style={{ ...T.body, fontSize: 15, fontWeight: 600 }}>No student has this id.</p>
          <p style={{ ...T.bodyDim, marginTop: 6 }}>They may have been deleted. Find them on All students.</p>
        </Card>
      </ListPage>
    );
  }

  const s = loaded.data;
  const nowMs = Date.parse(s.generatedAt);
  return (
    <ListPage>
      {back}
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ ...T.display, fontSize: 28, overflowWrap: "anywhere" }}>{s.name}</h1>
        <FactsLine parts={[s.email, s.day != null ? `Day ${s.day}` : null, s.username ? `@${s.username}` : null]} style={{ marginTop: 4, overflowWrap: "anywhere" }} />
        <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 10 }}>
          <MembershipPill status={s.status} />
          {s.canceling && <Pill tone="danger">Canceling</Pill>}
          {s.activity && <ActivityPill label={s.activity} />}
          {s.areaName && <Pill tone="neutral">In {s.areaName}</Pill>}
        </div>
      </header>

      {s.courseProblem && <Warning>{s.courseProblem}</Warning>}

      <StatGrid student={s} nowMs={nowMs} />

      <ExemptCard student={s} transport={transport} onSaved={(v) => patch({ csmExempt: v })} />

      <Block title="Whop sync">
        <SyncBlock sync={s.sync} />
      </Block>

      <Block title="30% off">
        <DiscountBlock student={s} transport={transport} onSaved={(v) => patch({ adVerified: v })} />
      </Block>

      <Block title="Lesson progress">
        <LessonsBlock areas={s.areas} />
      </Block>

      <Block title="Quick DMs">
        <QuickDms student={s} />
      </Block>
    </ListPage>
  );
}

/** A titled block of the page. */
export function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ ...T.eyebrow, fontSize: 12, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function readValue<T>(r: Read<T>, show: (v: T) => string): string {
  return r.ok ? show(r.data) : COULD_NOT_LOAD;
}

/** Progress, streak, first payment, last activity. A failed read reads "Couldn't load". */
export function StatGrid({ student: s, nowMs, compact = false }: { student: StudentDetail; nowMs: number; compact?: boolean }) {
  return (
    <div className={compact ? "grid grid-cols-2" : "grid grid-cols-2 lg:grid-cols-4"} style={{ gap: 12, marginBottom: 20 }}>
      <Stat label="Progress" value={readValue(s.progress, (p) => `${p}%`)} tone={s.progress.ok ? "accent" : "default"} />
      <Stat label="Streak" value={readValue(s.streak, (d) => `${d} ${d === 1 ? "day" : "days"}`)} />
      <Stat label="First paid" value={s.firstPaidAt ? dayLabel(s.firstPaidAt) : "None"} />
      <Stat label="Last active" value={s.lastActiveAt ? agoText(s.lastActiveAt, nowMs) : "Never"} />
    </div>
  );
}

function ExemptCard({
  student: s,
  transport,
  onSaved,
}: {
  student: StudentDetail;
  transport: PeopleTransport;
  onSaved: (v: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card padding={14} style={{ marginBottom: 24 }}>
      <label className="flex items-center" style={{ gap: 12, minHeight: TAP, cursor: saving ? "wait" : "pointer" }}>
        <input
          type="checkbox"
          checked={s.csmExempt}
          disabled={saving}
          onChange={async (e) => {
            const next = e.currentTarget.checked;
            setSaving(true);
            setError(null);
            const r = await transport.setExempt(s.id, next);
            setSaving(false);
            if (r.ok) onSaved(next);
            else setError(r.error);
          }}
          style={{ width: 18, height: 18 }}
        />
        <span style={T.bodyDim}>
          <strong style={{ color: "var(--color-text-primary)" }}>Leave out of the tasks</strong>.{" "}
          {s.csmExempt ? "No task and no day 28 DM is made for this account." : "For a team test account."}
        </span>
      </label>
      {error && (
        <p role="alert" style={{ ...T.body, marginTop: 8 }}>
          {error}
        </p>
      )}
    </Card>
  );
}

const SYNC_PILL: Record<Exclude<SyncView["state"], "never">, { tone: PillTone; text: string }> = {
  synced: { tone: "success", text: "Synced since the switch" },
  stale: { tone: "warning", text: "Not synced since the switch" },
  unknown: { tone: "neutral", text: "Couldn't tell if it synced since the switch" },
};

function SyncBlock({ sync }: { sync: StudentDetail["sync"] }) {
  if (!sync.ok) {
    return (
      <Card padding={16}>
        <p style={T.body}>{COULD_NOT_LOAD} the Whop sync ({sync.error}).</p>
      </Card>
    );
  }
  const v = sync.data;
  if (v.state === "never") {
    return (
      <Card padding={16}>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <Pill tone="neutral">Never synced</Pill>
          <p style={T.bodyDim}>No Whop watching has been pulled for this student yet.</p>
        </div>
      </Card>
    );
  }
  const pill = SYNC_PILL[v.state];
  return (
    <Card padding={16}>
      <div className="flex flex-wrap items-center" style={{ gap: 8, marginBottom: 12 }}>
        <Pill tone={pill.tone}>{pill.text}</Pill>
        <span style={{ ...T.bodyDim, fontSize: 12 }}>Last synced {dayTimeLabel(v.lastSyncAt)} (Croatia time)</span>
      </div>
      {v.state === "stale" && (
        <p style={{ ...T.bodyDim, lineHeight: 1.5, marginBottom: 12 }}>
          These numbers are from before the course switch. They change at the next sync.
        </p>
      )}
      <div className="grid grid-cols-3" style={{ gap: 12, marginBottom: 12 }}>
        <SyncNumber label="Fetched" value={v.fetched} />
        <SyncNumber label="Matched" value={v.matched} />
        <SyncNumber label="Unmatched" value={v.unmatched.length} />
      </div>
      {/* The backfill's note (lessons opened on Whop, none finished) is not a
          failure: a grey dot and "Note:". Anything else is the last error: a
          red dot and "Last error:". The words stay in the readable colour; red
          words measure under 4.5:1 on the dark surfaces. */}
      {v.error && (
        <p
          className="flex items-start"
          style={{ ...T.body, gap: 10, lineHeight: 1.5, padding: "8px 10px", borderRadius: "var(--radius-chip)", background: "var(--color-bg-elevated)", overflowWrap: "anywhere" }}
        >
          <Dot color={v.error.note ? "var(--color-neutral)" : "var(--color-danger)"} />
          <span>
            {v.error.note ? "Note: " : "Last error: "}
            {v.error.text}
            {v.error.note ? " (lessons opened on Whop, none finished yet)" : ""}
            {v.error.at ? `, ${dayTimeLabel(v.error.at)}` : ""}
          </span>
        </p>
      )}
      {v.unmatched.length > 0 ? (
        <details style={{ marginTop: 12 }}>
          <summary style={{ ...T.body, fontWeight: 600, cursor: "pointer", padding: "12px 0", lineHeight: "20px" }}>
            Whop lessons with no lesson here ({v.unmatched.length})
          </summary>
          <div style={{ padding: 12, borderRadius: "var(--radius-chip)", background: "var(--color-bg-elevated)", maxHeight: 192, overflowY: "auto" }}>
            {v.unmatched.map((id) => (
              <p key={id} className="select-all" style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
                {id}
              </p>
            ))}
          </div>
        </details>
      ) : (
        <p style={{ ...T.bodyDim, fontSize: 12 }}>Every Whop lesson this student watched has a lesson here.</p>
      )}
    </Card>
  );
}

function SyncNumber({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p style={{ ...T.eyebrow, fontSize: 12 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {value ?? "None"}
      </p>
    </div>
  );
}

/** The latest 30% request (any date), the link to the 30% page, and the ads tick. */
export function DiscountBlock({
  student: s,
  transport,
  onSaved,
  compact = false,
}: {
  student: StudentDetail;
  transport: PeopleTransport;
  onSaved: (v: boolean) => void;
  compact?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = s.discount;
  return (
    <Card padding={16}>
      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        {!d.ok ? (
          <span style={T.body}>{COULD_NOT_LOAD} the 30% request ({d.error}).</span>
        ) : d.data ? (
          <>
            <Pill tone={DISCOUNT_TONE[d.data.status] ?? "neutral"}>{d.data.text}</Pill>
            <span style={{ ...T.bodyDim, fontSize: 12 }}>Asked {dayLabel(d.data.askedAt)}</span>
            {d.data.code && <CopyButton text={d.data.code} label={`Copy ${d.data.code}`} />}
          </>
        ) : (
          <span style={T.bodyDim}>No 30% request.</span>
        )}
        <Link
          href={`/admin/discounts?student=${encodeURIComponent(s.id)}`}
          style={{ display: "inline-flex", alignItems: "center", minHeight: TAP, marginLeft: "auto", color: "var(--color-accent-dark)", fontSize: 13, fontWeight: 600 }}
        >
          See on the 30% page
        </Link>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
        <label className="flex items-start" style={{ gap: 12, minHeight: TAP, cursor: saving ? "wait" : "pointer" }}>
          <input
            type="checkbox"
            checked={s.adVerified}
            disabled={saving}
            onChange={async (e) => {
              const next = e.currentTarget.checked;
              setSaving(true);
              setError(null);
              const r = await transport.setAdVerified(s.id, next);
              setSaving(false);
              if (r.ok) onSaved(next);
              else setError(r.error);
            }}
            style={{ width: 18, height: 18, marginTop: 2 }}
          />
          <span>
            <span style={{ ...T.body, fontWeight: 600, display: "block" }}>Ad submissions verified</span>
            {compact ? (
              <span style={{ ...T.bodyDim, fontSize: 12 }}>
                Approving the 30% no longer needs it. Tick after confirming submissions in Discord.
              </span>
            ) : (
              <span style={{ ...T.bodyDim, fontSize: 12 }}>
                Tick this once you&rsquo;ve confirmed the student submitted all action items in the Discord ad-review channel. Approving the 30% no longer needs it.
              </span>
            )}
          </span>
        </label>
        {error && (
          <p role="alert" style={{ ...T.body, marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

function LessonsBlock({ areas }: { areas: StudentDetail["areas"] }) {
  if (!areas.ok) {
    return (
      <Card padding={16}>
        <p style={T.body}>{COULD_NOT_LOAD} the lessons ({areas.error}).</p>
      </Card>
    );
  }
  return (
    <Card padding={0}>
      {areas.data.map((a) => (
        <AreaLessons key={a.id} area={a} />
      ))}
    </Card>
  );
}

/** One area: its count and bar, and its lessons under a fold that says Show and Hide. */
function AreaLessons({ area: a }: { area: Extract<StudentDetail["areas"], { ok: true }>["data"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="list-row" style={{ display: "block", padding: "0 16px" }} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex flex-wrap items-center" style={{ gap: "4px 12px", minHeight: TAP, cursor: "pointer", listStyle: "none" }}>
        <span style={{ ...T.body, fontWeight: 600, flex: "1 1 140px", minWidth: 0 }}>{a.name}</span>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
          {a.done} of {a.total} done
        </span>
        <span style={{ width: 96 }}>
          <Meter value={a.total ? Math.round((a.done / a.total) * 100) : 0} label={`${a.name} progress`} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent-dark)", width: 36, textAlign: "right" }}>
          {open ? "Hide" : "Show"}
        </span>
      </summary>
      <ul style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0 12px" }}>
            {a.lessons.map((l) => (
              <li key={l.id} className="flex items-center" style={{ gap: 8, fontSize: 13 }}>
                <span
                  aria-hidden="true"
                  style={{
                    flex: "none",
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    border: `1px solid ${l.done ? "var(--color-accent-dark)" : "var(--color-border-strong)"}`,
                    background: l.done ? "var(--color-accent-dark)" : "transparent",
                  }}
                />
                <span style={{ color: l.done ? "var(--color-text-secondary)" : "var(--color-text-primary)", overflowWrap: "anywhere" }}>
                  {l.title}
                </span>
            <span className="sr-only">{l.done ? "done" : "not done"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The three quick DMs, copied as they were written (WI-10 rewrites their words). */
function QuickDms({ student: s }: { student: StudentDetail }) {
  const overallPercent = s.progress.ok ? s.progress.data : null;
  const dayNumber = s.day;
  const name = s.nameOnFile;
  const dmTemplates = [
    {
      label: "Welcome",
      text: `Hey ${name || "there"}! Welcome to EcomTalent. I'm here to help you get the most out of your first 30 days. Have you checked out your expedition map yet? Let me know if you have any questions!`,
    },
    {
      label: "Check-in",
      text: `Hey ${name || "there"}! Just checking in — how's everything going? I noticed you're on Day ${dayNumber}. Is there anything I can help you with?`,
    },
    {
      label: "Encouragement",
      text: `Hey ${name || "there"}! You're making great progress — ${overallPercent == null ? "—" : `${overallPercent}%`} through your expedition. Keep going! The next region is where things really click.`,
    },
  ];
  return (
    <Card padding={16}>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        {dmTemplates.map((t) => (
          <CopyButton key={t.label} text={t.text} label={t.label} />
        ))}
      </div>
      <p style={{ ...T.bodyDim, fontSize: 12, marginTop: 10 }}>Each button copies its DM.</p>
    </Card>
  );
}

