"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Pill, T } from "@/components/admin/ui";
import { FailedMeta, ListHeader, ListPage, LoadError, SkeletonRows, TAP } from "@/components/admin/list-parts";
import { ActivityPill, FactsLine, Meter, STATUS_WORDS } from "@/components/admin/people-parts";
import { ProblemNotice, ReadFailure } from "@/components/admin/review-parts";
import { Block, DiscountBlock, StatGrid, useStudent } from "@/components/admin/students/StudentDetailView";
import { StudentName } from "@/components/admin/student-name";
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
 *
 * The render review's fix round: the board sits in the page's column, as
 * every other page's content does (it broke out to 1584px, and at 1280px wide
 * its Month 2+ column was cut off at the window's edge). From 1120px wide the
 * six columns fit side by side in it; narrower, the board scrolls sideways
 * inside itself, never the page. A card's name is the name of every admin
 * page (student-name.tsx: a link to the student's page, @username after it);
 * the rest of the card is one button under it that opens the drawer.
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: Journey };

/** The activity colours, on each tile's dot (status is never colour alone: its word is beside it), as Insights' Activity right now. */
const ACTIVITY_DOT = {
  not_started: "var(--color-neutral)",
  moving: "var(--color-success)",
  slipping: "var(--color-warning)",
  stalled: "var(--color-danger)",
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
      meta={
        data ? (
          `Updated ${clockLabel(data.generatedAt)}${busy ? " · Updating" : ""} · ${data.total} ${data.total === 1 ? "student" : "students"}`
        ) : loaded.kind === "error" ? (
          <FailedMeta />
        ) : (
          "Loading"
        )
      }
      // Kept while the board loads or failed, so the header never jumps (the review's fix round).
      action={
        <Button variant="raised" size="md" busy={busy || loaded.kind === "loading"} disabled={loaded.kind === "loading"} onClick={() => void refresh()}>
          Refresh
        </Button>
      }
    />
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header(null)}
        <SkeletonRows rows={4} label="Loading the journey" />
      </ListPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null)}
        <LoadError title="Couldn't load the journey." detail={loaded.error} onRetry={() => void refresh()} busy={busy} />
      </ListPage>
    );
  }

  const data = loaded.data;
  return (
    <ListPage>
      {header(data)}
      {refreshError && <ProblemNotice text="Couldn't refresh the board, so it may be out of date. Press Refresh." raw={refreshError} />}
      {data.problems.map((p) => (
        <ProblemNotice key={p.text} text={p.text} raw={p.error} />
      ))}

      {data.activity && (
        <div
          aria-label="Activity of the students who have not churned"
          className="grid grid-cols-2 sm:grid-cols-4"
          style={{ gap: 8, marginBottom: 16 }}
        >
          {ACTIVITY_ORDER.map((label) => (
            <Card key={label} padding={12}>
              <p style={{ fontSize: 22, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                {data.activity?.[label] ?? 0}
              </p>
              <p className="flex items-center" style={{ gap: 6, fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: ACTIVITY_DOT[label], flex: "none" }} />
                {ACTIVITY_TEXT[label]}
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* The board, in the page's column. From 1120px wide its six columns (164px at least, 8px apart) fit in
          it side by side; narrower, they keep 232px each and the board scrolls sideways inside itself, out to
          the window's edges on a phone. The page never scrolls sideways. */}
      <div
        data-board=""
        className="max-sm:-mx-4 max-sm:px-4"
        style={{ overflowX: "auto", paddingBottom: 8, scrollSnapType: "x proximity", scrollPaddingInline: 16 }}
      >
        <div
          className="grid grid-cols-[repeat(6,minmax(232px,1fr))] lg:grid-cols-[repeat(6,minmax(164px,1fr))]"
          style={{ gap: 8, alignItems: "start" }}
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
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
    </ListPage>
  );
}

/**
 * A card: the student's name (a link to their page, @username after it), the
 * day, the area and the pills, the progress and the last activity. One button
 * lies under the whole card and opens the drawer; the words above it let
 * every press through to it but the name's.
 */
function JourneyCardView({ card: c, onOpen }: { card: JourneyCard; onOpen: () => void }) {
  return (
    <div
      data-journey-card={c.id}
      className="surface-resting"
      style={{
        position: "relative",
        minHeight: TAP,
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        color: "inherit",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          padding: 0,
          border: "none",
          borderRadius: "inherit",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        <span className="sr-only">Show {c.name}</span>
      </button>
      <div style={{ position: "relative", pointerEvents: "none", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* The name and @username wrap as the card's width asks; the day always on the line under them, so the
            cards of a column read alike. */}
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="flex flex-wrap items-baseline" style={{ gap: "0 8px", minWidth: 0 }}>
            <StudentName id={c.id} name={c.name} username={c.username} size={14} />
          </span>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>Day {c.day}</span>
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
      </div>
    </div>
  );
}

/**
 * The area a student is in: its numeral, as the map numbers the areas, and
 * its name. A place, not a status, so no dot; the numeral in the primary ink
 * (Airy Blue is for links: the render review's fix round).
 */
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
      <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{numeral}</span>
      {name}
    </span>
  );
}

/** The drawer: one student's detail, fresh for each student (keyed by the page). */
function JourneyDrawer({ studentId, transport, onClose }: { studentId: string; transport: PeopleTransport; onClose: () => void }) {
  const { loaded, busy, retry } = useStudent(transport, studentId);

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
            <div className="flex flex-wrap items-baseline justify-between" style={{ gap: "0 12px" }}>
              {/* The name as on every admin page: a link to the student's page, @username after it. */}
              <h2 className="flex flex-wrap items-baseline" style={{ ...T.heading, gap: "2px 10px", overflowWrap: "anywhere", minWidth: 0 }}>
                <StudentName id={loaded.data.id} name={loaded.data.name} username={loaded.data.username} size={20} />
              </h2>
              <Link
                href={`/admin/students/${encodeURIComponent(loaded.data.id)}`}
                style={{ display: "inline-flex", alignItems: "center", minHeight: TAP, fontSize: 13, fontWeight: 600, color: "var(--color-accent-dark)", whiteSpace: "nowrap" }}
              >
                Open the full page
              </Link>
            </div>
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
                  <ReadFailure lead="Couldn't load the lessons." raw={loaded.data.areas.error} />
                </Card>
              )}
            </Block>
            <Block title="Action items">
              <Card padding={14}>
                {!loaded.data.actionItems.ok ? (
                  <ReadFailure lead="Couldn't load the action items." raw={loaded.data.actionItems.error} />
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
              <DiscountBlock student={loaded.data} />
            </Block>
          </>
        )}
      </aside>
    </>
  );
}
