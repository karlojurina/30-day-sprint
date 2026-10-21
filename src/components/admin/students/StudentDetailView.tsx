"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Pill, Stat, T } from "@/components/admin/ui";
import type { PillTone } from "@/components/admin/ui";
import { CopyButton, ListPage, LoadError, MembershipPill, SkeletonRows, TAP } from "@/components/admin/list-parts";
import { ActivityPill, Dot, FactsLine, Meter } from "@/components/admin/people-parts";
import { ProblemNotice, ReadFailure } from "@/components/admin/review-parts";
import type { Answer } from "@/lib/admin/admin-transport";
import { dayLabel, dayTimeLabel } from "@/lib/admin/croatia-dates";
import { agoText, type Read } from "@/lib/admin/people-common";
import { peopleTransport, type PeopleTransport } from "@/lib/admin/people-transport";
import { quickDms, type StudentDetail, type SyncView } from "@/lib/admin/student-detail";

/**
 * One student, /admin/students/[id] (admin rebuild 2, D9), in the brand
 * kit's dark look. The reads and the rules are in
 * src/lib/admin/student-detail.ts; this file shows them.
 *
 * Each block whose read failed says "Couldn't load", never 0%, 0 days or
 * "No application submitted", why in plain words with the database's own
 * behind Details; the student's own read failing is the page's error, with
 * Retry, and an id with no student says so. The Whop sync block says "Not
 * synced since the switch" when its numbers are the old course's
 * (whopPulled, as the 30% page marks it). No plan anywhere.
 *
 * The order is what the team uses most first: the numbers, Whop sync, the
 * 30%, the lessons, the quick DMs; then, quiet at the foot, the settings:
 * "Leave out of the tasks" (a team test account) and, folded under More,
 * "Ad submissions verified", which approving the 30% no longer needs (the
 * review's fix round). The quick DMs are the messages draft's words
 * (student-detail.ts quickDms).
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "missing" }
  | { kind: "ready"; data: StudentDetail };

export const COULD_NOT_LOAD = "Couldn't load";

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

      {s.courseProblem && <ProblemNotice text={s.courseProblem.text} raw={s.courseProblem.error} />}

      <StatGrid student={s} nowMs={nowMs} />

      <Block title="Whop sync">
        <SyncBlock sync={s.sync} />
      </Block>

      <Block title="30% off">
        <DiscountBlock student={s} />
      </Block>

      <Block title="Lesson progress">
        <LessonsBlock areas={s.areas} />
      </Block>

      <Block title="Quick DMs">
        <QuickDms student={s} />
      </Block>

      <SettingsRow student={s} transport={transport} onSaved={patch} />
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

/** A tick that saves itself, with its words beside it and what went wrong under it. */
function SavingTick({
  checked,
  title,
  description,
  save,
  onSaved,
}: {
  checked: boolean;
  title: string;
  description: string;
  save: (next: boolean) => Promise<Answer<null>>;
  onSaved: (next: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="flex items-start" style={{ gap: 12, minHeight: TAP, padding: "12px 0", cursor: saving ? "wait" : "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          onChange={async (e) => {
            const next = e.currentTarget.checked;
            setSaving(true);
            setError(null);
            const r = await save(next);
            setSaving(false);
            if (r.ok) onSaved(next);
            else setError(r.error);
          }}
          style={{ width: 18, height: 18, marginTop: 1, flex: "none" }}
        />
        <span style={{ ...T.bodyDim, lineHeight: 1.5 }}>
          <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{title}</span>
          <span aria-hidden="true">. </span>
          {description}
        </span>
      </label>
      {error && <ReadFailure raw={error} lead="Couldn't save it." style={{ marginBottom: 8 }} />}
    </div>
  );
}

/**
 * The settings, quiet, at the foot of the page: "Leave out of the tasks" (a
 * team test account), and under a closed More, "Ad submissions verified",
 * which approving the 30% no longer needs.
 */
function SettingsRow({
  student: s,
  transport,
  onSaved,
}: {
  student: StudentDetail;
  transport: PeopleTransport;
  onSaved: (change: Partial<StudentDetail>) => void;
}) {
  return (
    <section aria-label="Settings" data-settings="" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
      <SavingTick
        checked={s.csmExempt}
        title="Leave out of the tasks"
        description={s.csmExempt ? "No task and no day 28 DM is made for this account." : "For a team test account."}
        save={(next) => transport.setExempt(s.id, next)}
        onSaved={(next) => onSaved({ csmExempt: next })}
      />
      <details data-more="">
        {/* A list item keeps the browser's triangle, so it reads as something to press; 44px with its padding. */}
        <summary style={{ display: "list-item", padding: "12px 0", lineHeight: "20px", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", cursor: "pointer" }}>
          More
        </summary>
        <SavingTick
          checked={s.adVerified}
          title="Ad submissions verified"
          description="A note for the team: the student's action items were checked in the Discord ad-review channel. Approving the 30% does not need it."
          save={(next) => transport.setAdVerified(s.id, next)}
          onSaved={(next) => onSaved({ adVerified: next })}
        />
      </details>
    </section>
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
        <ReadFailure lead={`${COULD_NOT_LOAD} the Whop sync.`} raw={sync.error} />
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

/** The latest 30% request (any date), in the 30% page's words and colours, and the link to the 30% page. */
export function DiscountBlock({ student: s }: { student: StudentDetail }) {
  const d = s.discount;
  return (
    <Card padding={16}>
      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        {!d.ok ? (
          <ReadFailure lead={`${COULD_NOT_LOAD} the 30% request.`} raw={d.error} style={{ flex: "1 1 220px" }} />
        ) : d.data ? (
          <>
            <Pill tone={d.data.tone as PillTone}>{d.data.text}</Pill>
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
    </Card>
  );
}

function LessonsBlock({ areas }: { areas: StudentDetail["areas"] }) {
  if (!areas.ok) {
    return (
      <Card padding={16}>
        <ReadFailure lead={`${COULD_NOT_LOAD} the lessons.`} raw={areas.error} />
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

/**
 * One area: its count and bar, its lessons under a fold the whole row opens
 * (a chevron says which way). Wide: one line, the name, "3 of 3 done", the
 * bar and the chevron. Under 640px: the name with "3 of 3 done" and the
 * chevron on the right, then the bar across the row with its percent, 12px
 * of air above and below.
 */
function AreaLessons({ area: a }: { area: Extract<StudentDetail["areas"], { ok: true }>["data"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="list-row" style={{ display: "block", padding: "0 16px" }} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary
        className="grid items-center grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_auto_96px_auto] py-3 sm:py-0"
        style={{ columnGap: 12, rowGap: 8, minHeight: TAP, cursor: "pointer", listStyle: "none" }}
        aria-label={`${a.name}, ${a.done} of ${a.total} done. ${open ? "Hide" : "Show"} its lessons.`}
      >
        <span className="col-start-1 row-start-1" style={{ ...T.body, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>
          {a.name}
        </span>
        <span className="col-start-2 row-start-1" style={{ fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {a.done} of {a.total} done
        </span>
        <span className="col-span-3 col-start-1 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1" style={{ minWidth: 0 }}>
          <Meter value={a.total ? Math.round((a.done / a.total) * 100) : 0} label={`${a.name} progress`} />
        </span>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className="col-start-3 row-start-1 sm:col-start-4"
          style={{ justifySelf: "end", transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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

/** The three quick DMs, in the messages draft's words (student-detail.ts quickDms). */
function QuickDms({ student: s }: { student: StudentDetail }) {
  const dmTemplates = quickDms(s);
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

