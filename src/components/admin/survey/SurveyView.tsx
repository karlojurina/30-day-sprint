"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, Pill, T } from "@/components/admin/ui";
import { ListHeader, ListPage, LoadError, SkeletonRows } from "@/components/admin/list-parts";
import { DiscountFeedbackResponses } from "@/components/admin/DiscountFeedbackResponses";
import type { Answer } from "@/lib/admin/admin-transport";
import { dayLabel } from "@/lib/admin/croatia-dates";
import {
  SURVEY_LISTED_FROM,
  isAnswered,
  paceTally,
  recommendAverage,
  scoreSpread,
  splitByListedFrom,
  statusCounts,
  statusWords,
} from "@/lib/admin/survey-data";
import type { SurveyData } from "@/lib/admin/survey-data";

/**
 * /admin/feedback/survey (admin rebuild 2, WI-9), in the brand kit's dark
 * look: what students answered in the 30% application's survey, one card
 * per application, newest first, with the status named as the 30% page
 * names it (Applied, Approved, Rejected, Code Applied).
 *
 * Since the review's fix round: the applications from 1 October, as the 30%
 * page lists them, with one line counting the older ones and a toggle to
 * show them; a compact summary on top (the average, the scores' spread and
 * how many picked each pace answer), over the applications shown; and each
 * card names only the questions its student answered.
 *
 * `load` is the page's one read (loadSurveyData in src/lib/admin/
 * survey-data.ts, or the dev page's made-up one): a failed read shows what
 * could not be read and Retry, never an empty list.
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: SurveyData };

const toLoaded = (r: Answer<SurveyData>): Loaded =>
  r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error };

export function SurveyView({ load }: { load: () => Promise<Answer<SurveyData>> }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  /** The applications from before 1 October are shown too. */
  const [showOlder, setShowOlder] = useState(false);
  const seq = useRef(0);

  /** One read; null when a newer read started meanwhile (that one's answer wins). */
  const read = useCallback(async (): Promise<Answer<SurveyData> | null> => {
    const mine = ++seq.current;
    const r = await load();
    return mine === seq.current ? r : null;
  }, [load]);

  useEffect(() => {
    let alive = true;
    void read().then((r) => {
      if (alive && r) setLoaded(toLoaded(r));
    });
    return () => {
      alive = false;
    };
  }, [read]);

  async function again() {
    setBusy(true);
    const r = await read();
    setBusy(false);
    if (r) setLoaded(toLoaded(r));
  }

  const header = (meta: React.ReactNode, action?: React.ReactNode) => (
    <ListHeader
      title="Survey"
      description="What students answered when they applied for the 30%, newest application first."
      meta={meta}
      action={action}
    />
  );

  // The header keeps its Refresh while the list loads or failed, so it never jumps (the review's fix round).
  const refreshButton = (
    <Button variant="raised" size="md" busy={busy || loaded.kind === "loading"} disabled={loaded.kind === "loading"} onClick={() => void again()}>
      Refresh
    </Button>
  );
  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading", refreshButton)}
        <SkeletonRows rows={3} label="Loading the survey answers" />
      </ListPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null, refreshButton)}
        <LoadError title="Couldn't load the survey." detail={loaded.error} onRetry={() => void again()} busy={busy} />
      </ListPage>
    );
  }

  const { questions } = loaded.data;
  const { listed, older } = splitByListedFrom(loaded.data.applications);
  const applications = showOlder ? loaded.data.applications : listed;
  const avg = recommendAverage(loaded.data, applications);
  const spread = scoreSpread(questions, applications);
  const pace = paceTally(questions, applications);
  const counts = statusCounts(applications);
  const fromDay = dayLabel(SURVEY_LISTED_FROM);

  return (
    <ListPage>
      {header(counts.map((c) => `${c.count} ${c.label}`).join(" · ") || (showOlder ? null : `Since ${fromDay}`), refreshButton)}

      {older.length > 0 && (
        <div className="flex flex-wrap items-center" style={{ gap: "4px 12px", marginBottom: 16 }}>
          <p style={{ ...T.bodyDim, lineHeight: 1.5 }} data-older={older.length}>
            {showOlder
              ? `Showing every application, ${older.length} of them from before ${fromDay}.`
              : `${older.length} ${older.length === 1 ? "application" : "applications"} from before ${fromDay} ${older.length === 1 ? "is" : "are"} not shown.`}
          </p>
          <Button variant="ghost" size="md" onClick={() => setShowOlder((v) => !v)}>
            {showOlder ? `Show from ${fromDay} only` : "Show them"}
          </Button>
        </div>
      )}

      {applications.length === 0 ? (
        <Card>
          <EmptyState
            title={older.length > 0 ? `No survey answers since ${fromDay} yet.` : "No survey answers yet."}
            description="When a student applies for the 30%, their answers show here."
          />
        </Card>
      ) : (
        <>
          <Card padding={0} style={{ marginBottom: 20 }}>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]">
              <div className="p-4" data-summary="average">
                <p style={{ ...T.eyebrow, color: "var(--color-text-secondary)" }}>Recommend score</p>
                <p style={{ marginTop: 8, fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
                  {avg.value == null ? "No answers" : avg.value.toFixed(1)}
                </p>
                <p style={{ ...T.bodyDim, marginTop: 6, fontSize: 12 }}>
                  {avg.count > 0
                    ? `Average of ${avg.count} ${avg.count === 1 ? "answer" : "answers"}${avg.scale ? `, scale ${avg.scale}` : ""}, ${applications.length} ${applications.length === 1 ? "application" : "applications"}`
                    : `${applications.length} ${applications.length === 1 ? "application" : "applications"}`}
                </p>
              </div>
              {spread && <Spread counts={spread.counts} />}
              {pace && <PaceTally counts={pace.counts} />}
            </div>
          </Card>
          <div className="flex flex-col" style={{ gap: 12 }}>
            {applications.map((app) => {
              const status = statusWords(app.status);
              const name = app.student?.name?.trim() || "Unknown student";
              return (
                <Card key={app.id} padding={16}>
                  <article aria-label={`${name}, ${status.label}`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="flex flex-wrap items-start justify-between" style={{ gap: "8px 12px" }}>
                      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                        <p style={{ ...T.body, fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{name}</p>
                        <p style={{ ...T.bodyDim, overflowWrap: "anywhere" }}>{app.student?.email || "No email on file"}</p>
                      </div>
                      <div className="flex items-center" style={{ gap: 10, flex: "none" }}>
                        <time dateTime={app.created_at} style={{ ...T.bodyDim, fontVariantNumeric: "tabular-nums" }}>
                          {dayLabel(app.created_at)}
                        </time>
                        <Pill tone={status.tone}>{status.label}</Pill>
                      </div>
                    </div>
                    <DiscountFeedbackResponses responses={app.answers.filter(isAnswered)} questions={questions} />
                  </article>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </ListPage>
  );
}

/** A part of the summary, beside the others on a wide screen, under them on a phone, a hairline between. */
function SummaryPart({ title, name, children }: { title: string; name: string; children: React.ReactNode }) {
  return (
    <div className="p-4 border-t md:border-t-0 md:border-l" style={{ borderColor: "var(--color-border)", minWidth: 0 }} data-summary={name}>
      <p style={{ ...T.eyebrow, color: "var(--color-text-secondary)", marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}

/** How many gave each score: a column per score, its count over it, in Airy Blue. */
function Spread({ counts }: { counts: Array<{ score: number; count: number }> }) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <SummaryPart title="Scores" name="spread">
      <div role="img" aria-label={counts.map((c) => `${c.score}: ${c.count}`).join(", ")} className="flex items-end" style={{ gap: 4, height: 72 }}>
        {counts.map((c) => (
          <div key={c.score} aria-hidden="true" style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 11, lineHeight: "13px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{c.count > 0 ? c.count : ""}</span>
            <div
              style={{
                width: "100%",
                maxWidth: 22,
                height: Math.max(c.count > 0 ? 3 : 1, Math.round((c.count / max) * 44)),
                borderRadius: "3px 3px 0 0",
                background: c.count > 0 ? "var(--color-accent-dark)" : "var(--color-border)",
              }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex" style={{ gap: 4, marginTop: 4 }}>
        {counts.map((c) => (
          <span key={c.score} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center", fontSize: 11, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {c.score}
          </span>
        ))}
      </div>
    </SummaryPart>
  );
}

/** How many picked each pace answer, in the form's order: the answer, a bar, the count. */
function PaceTally({ counts }: { counts: Array<{ choice: string; count: number }> }) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <SummaryPart title="Pace" name="pace">
      <ul className="flex flex-col" style={{ gap: 6 }}>
        {counts.map((c) => (
          <li key={c.choice} className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 7.5em) minmax(0, 1fr) 2em", gap: 8, fontSize: 12, color: "var(--color-text-secondary)" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.choice}</span>
            <span aria-hidden="true" style={{ height: 6, borderRadius: 3, background: "var(--color-fill-secondary)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(c.count / max) * 100}%`, background: "var(--color-accent-dark)" }} />
            </span>
            <span style={{ textAlign: "right", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{c.count}</span>
          </li>
        ))}
      </ul>
    </SummaryPart>
  );
}
