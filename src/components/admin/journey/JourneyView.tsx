"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Pill, T } from "@/components/admin/ui";
import { ListHeader, LoadError, SkeletonRows, TAP } from "@/components/admin/list-parts";
import { ActivityPill, FactsLine, Meter, STATUS_WORDS, Warning } from "@/components/admin/people-parts";
import { Block, DiscountBlock, StatGrid, useStudent } from "@/components/admin/students/StudentDetailView";
import type { Answer } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import type { Journey, JourneyCard } from "@/lib/admin/journey-board";
import { peopleTransport, type PeopleTransport } from "@/lib/admin/people-transport";
import { ACTIVITY_ORDER, ACTIVITY_TEXT } from "@/lib/useJourneyPaceCounts";

/**
 * The Student journey, /admin/journey (admin rebuild 2, D8), in the brand
 * kit's dark look: the new program's students (a first payment on or after
 * the launch, 9 October, any plan) in six columns by days since that
 * payment: Week 1 to 4, Churned and Month 2+. The reads and the rules are in
 * src/lib/admin/journey-board.ts; this file shows them.
 *
 * A read that failed says so: the students read is the page's error, with
 * Retry, never an empty board; a failed progress, area or course read shows
 * a line above the board and "Couldn't load" on the cards.
 *
 * A card opens the drawer with the student's detail. The drawer is mounted
 * fresh for each student (keyed by id), so it never shows the last
 * student's answers (fix lane G1, admin-2), and an answer that lands after
 * it moved on is dropped (useStudent).
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: Journey };

/**
 * ListPage's gutters (16px on a phone), wider: the six columns sit side by
 * side from about 1400px; under that the board scrolls sideways inside
 * itself.
 */
function BoardPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 sm:px-8 lg:px-12 pt-4 sm:pt-10 pb-28" style={{ maxWidth: 1680, margin: "0 auto" }}>
      {children}
    </div>
  );
}

const ACTIVITY_COLOR = {
  not_started: "var(--color-text-primary)",
  moving: "var(--color-success)",
  slipping: "var(--color-warning)",
  stalled: "var(--color-text-primary)",
} as const;

export function JourneyView({
  transport = peopleTransport,
  initialStudent = null,
}: {
  transport?: PeopleTransport;
  /** A student whose drawer is open from the start (the dev page's ?drawer=). */
  initialStudent?: string | null;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(initialStudent);
  const seq = useRef(0);

  const fetchBoard = useCallback(async (): Promise<Answer<Journey> | null> => {
    const mine = ++seq.current;
    const r = await transport.loadJourney();
    return mine === seq.current ? r : null;
  }, [transport]);

  useEffect(() => {
    let alive = true;
    void fetchBoard().then((r) => {
      if (alive && r) setLoaded(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
    });
    return () => {
      alive = false;
    };
  }, [fetchBoard]);

  async function refresh() {
    setBusy(true);
    const r = await fetchBoard();
    setBusy(false);
    if (!r) return;
    if (r.ok) {
      setLoaded({ kind: "ready", data: r.data });
      setRefreshError(null);
    } else if (loaded.kind === "ready") {
      setRefreshError(r.error);
    } else {
      setLoaded({ kind: "error", error: r.error });
    }
  }

  const header = (data: Journey | null) => (
    <ListHeader
      title="Student journey"
      description={`The new program's students: a first payment on or after ${dayLabel(data?.launchedAt ?? "2026-10-08T22:00:00.000Z")}, on any plan, by days since that payment. Open a card for the student.`}
      meta={data ? `Updated ${clockLabel(data.generatedAt)}${busy ? " · Updating" : ""} · ${data.total} ${data.total === 1 ? "student" : "students"}` : "Loading"}
      action={
        data ? (
          <Button variant="raised" size="md" busy={busy} onClick={() => void refresh()}>
            Refresh
          </Button>
        ) : undefined
      }
    />
  );

  if (loaded.kind === "loading") {
    return (
      <BoardPage>
        {header(null)}
        <SkeletonRows rows={4} label="Loading the journey" />
      </BoardPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <BoardPage>
        {header(null)}
        <LoadError title="Couldn't load the journey." detail={loaded.error} onRetry={() => void refresh()} busy={busy} />
      </BoardPage>
    );
  }

  const data = loaded.data;
  return (
    <BoardPage>
      {header(data)}
      {refreshError && <Warning>Couldn&apos;t refresh the board ({refreshError}), so it may be out of date. Press Refresh.</Warning>}
      {data.problems.map((p) => (
        <Warning key={p}>{p}</Warning>
      ))}

      {data.activity && (
        <div
          aria-label="Activity of the students who have not churned"
          className="grid grid-cols-2 sm:grid-cols-4"
          style={{ gap: 8, marginBottom: 16 }}
        >
          {ACTIVITY_ORDER.map((label) => (
            <Card key={label} padding={12}>
              <p style={{ fontSize: 22, fontWeight: 600, color: ACTIVITY_COLOR[label], fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                {data.activity?.[label] ?? 0}
              </p>
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>{ACTIVITY_TEXT[label]}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Six columns of at least 208px (264px on a phone). Under that the board
          scrolls sideways inside itself; the page never does. */}
      <div style={{ overflowX: "auto", paddingBottom: 8, scrollSnapType: "x proximity" }}>
        <div
          className="grid grid-cols-[repeat(6,minmax(264px,1fr))] lg:grid-cols-[repeat(6,minmax(208px,1fr))]"
          style={{ gap: 12, alignItems: "start" }}
        >
          {data.columns.map((col) => (
            <section key={col.id} aria-label={col.label} style={{ minWidth: 0, scrollSnapAlign: "start" }}>
              <div className="flex items-baseline justify-between" style={{ padding: "0 4px", marginBottom: 8 }}>
                <div>
                  <h2 style={{ ...T.eyebrow, fontSize: 12, color: "var(--color-text-primary)" }}>{col.label}</h2>
                  <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{col.description}</p>
                </div>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{col.cards.length}</span>
              </div>
              <div className="lg:max-h-[70vh] lg:overflow-y-auto" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {col.cards.length === 0 ? (
                  <p
                    style={{
                      padding: "24px 12px",
                      textAlign: "center",
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      borderRadius: "var(--radius-control)",
                      border: "1px dashed var(--color-border)",
                    }}
                  >
                    No students
                  </p>
                ) : (
                  col.cards.map((c) => <JourneyCardView key={c.id} card={c} onOpen={() => setDrawer(c.id)} />)
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      {drawer && <JourneyDrawer key={drawer} studentId={drawer} transport={transport} onClose={() => setDrawer(null)} />}
    </BoardPage>
  );
}

function JourneyCardView({ card: c, onOpen }: { card: JourneyCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="surface-resting"
      style={{
        // The column scrolls on a wide screen: a card keeps its height instead of shrinking into it.
        flex: "none",
        width: "100%",
        textAlign: "left",
        padding: 14,
        minHeight: TAP,
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        cursor: "pointer",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span className="flex items-baseline" style={{ gap: 8, width: "100%" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>
          {c.name}
        </span>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums", flex: "none" }}>Day {c.day}</span>
      </span>
      <span className="flex flex-wrap items-center" style={{ gap: 6 }}>
        {c.area && <AreaChip numeral={c.area.numeral} name={c.area.name} />}
        {c.activity && <ActivityPill label={c.activity} />}
        {c.canceling && <Pill tone="warning">Canceling</Pill>}
        {c.status === "past_due" && <Pill tone="warning">Payment failed</Pill>}
      </span>
      <span style={{ display: "block", width: "100%" }}>
        <Meter value={c.progress} />
      </span>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Last active {c.lastActive === "Never" ? "never" : c.lastActive}</span>
    </button>
  );
}

/** The area a student is in: its numeral, as the map numbers the areas, and its name. A place, not a status, so no dot. */
function AreaChip({ numeral, name }: { numeral: string; name: string }) {
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: 6,
        padding: "2px 10px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        fontSize: 12,
        fontWeight: 500,
        color: "var(--color-text-secondary)",
      }}
    >
      <span style={{ color: "var(--color-accent-dark)", fontWeight: 600 }}>{numeral}</span>
      {name}
    </span>
  );
}

/** The drawer: one student's detail, fresh for each student (keyed by the page). */
function JourneyDrawer({ studentId, transport, onClose }: { studentId: string; transport: PeopleTransport; onClose: () => void }) {
  const { loaded, busy, retry, patch } = useStudent(transport, studentId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-label="Close the student"
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 40, border: "none", padding: 0, background: "rgba(0, 0, 0, 0.5)", cursor: "pointer" }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Student"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          width: "min(520px, 100vw)",
          overflowY: "auto",
          background: "var(--color-bg-primary)",
          borderLeft: "1px solid var(--color-border-strong)",
          padding: 20,
        }}
      >
        <div className="flex justify-end" style={{ marginBottom: 8 }}>
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
        {loaded.kind === "loading" && <SkeletonRows rows={3} label="Loading the student" />}
        {loaded.kind === "error" && <LoadError title="Couldn't load this student." detail={loaded.error} onRetry={() => void retry()} busy={busy} />}
        {loaded.kind === "missing" && <p style={T.body}>No student has this id any more.</p>}
        {loaded.kind === "ready" && (
          <>
            <h2 style={{ ...T.heading, overflowWrap: "anywhere" }}>{loaded.data.name}</h2>
            <FactsLine
              parts={[
                loaded.data.email,
                loaded.data.day != null ? `Day ${loaded.data.day}` : null,
                STATUS_WORDS[loaded.data.status] ?? (loaded.data.status || null),
              ]}
              style={{ marginTop: 2, marginBottom: 16, overflowWrap: "anywhere" }}
            />
            <StatGrid student={loaded.data} nowMs={Date.parse(loaded.data.generatedAt)} compact />
            <Block title="Lessons by area">
              {loaded.data.areas.ok ? (
                <Card padding={14}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {loaded.data.areas.data.map((a) => (
                      <div key={a.id} className="flex items-center" style={{ gap: 12 }}>
                        <span style={{ ...T.bodyDim, width: 132, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                        <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                          <Meter value={a.total ? Math.round((a.done / a.total) * 100) : 0} label={`${a.name} progress`} />
                        </span>
                        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", width: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {a.done}/{a.total}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <Card padding={14}>
                  <p style={T.body}>Couldn&apos;t load the lessons ({loaded.data.areas.error}).</p>
                </Card>
              )}
            </Block>
            <Block title="Action items">
              <Card padding={14}>
                {!loaded.data.actionItems.ok ? (
                  <p style={T.body}>Couldn&apos;t load the action items ({loaded.data.actionItems.error}).</p>
                ) : loaded.data.actionItems.data.length === 0 ? (
                  <p style={T.bodyDim}>This course has no action items.</p>
                ) : (
                  <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {loaded.data.actionItems.data.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center" style={{ gap: 8, fontSize: 13 }}>
                        <span style={{ flex: "1 1 160px", minWidth: 0, color: a.shipped ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>{a.title}</span>
                        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{a.shipped ? "Handed in" : "Not yet"}</span>
                        {a.link && (
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", minHeight: TAP, fontSize: 12, fontWeight: 600, color: "var(--color-accent-dark)" }}
                          >
                            Open the post
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Block>
            <Block title="30% off">
              <DiscountBlock student={loaded.data} transport={transport} onSaved={(v) => patch({ adVerified: v })} compact />
            </Block>
            <Link
              href={`/admin/students/${encodeURIComponent(loaded.data.id)}`}
              style={{ display: "inline-flex", alignItems: "center", minHeight: TAP, fontSize: 13, fontWeight: 600, color: "var(--color-accent-dark)" }}
            >
              Open the full page
            </Link>
          </>
        )}
      </aside>
    </>
  );
}
