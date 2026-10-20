"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, Pill, T } from "@/components/admin/ui";
import { ListHeader, ListPage, LoadError, SkeletonRows } from "@/components/admin/list-parts";
import { DiscountFeedbackResponses } from "@/components/admin/DiscountFeedbackResponses";
import type { Answer } from "@/lib/admin/admin-transport";
import { dayLabel } from "@/lib/admin/croatia-dates";
import { recommendAverage, statusCounts, statusWords } from "@/lib/admin/survey-data";
import type { SurveyData } from "@/lib/admin/survey-data";

/**
 * /admin/feedback/survey (admin rebuild 2, WI-9), in the brand kit's dark
 * look: what students answered in the 30% application's survey, one card
 * per application, newest first, with the status named as the 30% page
 * names it (Applied, Approved, Rejected, Code Applied).
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

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading")}
        <SkeletonRows rows={3} label="Loading the survey answers" />
      </ListPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null)}
        <LoadError title="Couldn't load the survey." detail={loaded.error} onRetry={() => void again()} busy={busy} />
      </ListPage>
    );
  }

  const { applications, questions } = loaded.data;
  const avg = recommendAverage(loaded.data);
  const counts = statusCounts(applications);

  return (
    <ListPage>
      {header(
        counts.map((c) => `${c.count} ${c.label}`).join(" · ") || null,
        <Button variant="raised" size="md" busy={busy} onClick={() => void again()}>
          Refresh
        </Button>,
      )}

      {applications.length === 0 ? (
        <Card>
          <EmptyState
            title="No survey answers yet."
            description="When a student applies for the 30%, their answers show here."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2" style={{ gap: 12, marginBottom: 20 }}>
            <Tile label="Applications" value={String(applications.length)} />
            <Tile
              label="Average recommend score"
              value={avg.value == null ? "No answers" : avg.value.toFixed(1)}
              sub={
                avg.count > 0
                  ? `${avg.count} ${avg.count === 1 ? "answer" : "answers"}${avg.scale ? `, scale ${avg.scale}` : ""}`
                  : undefined
              }
            />
          </div>
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
                    <DiscountFeedbackResponses responses={app.answers} questions={questions} />
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

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card padding={16}>
      <p style={{ ...T.eyebrow, color: "var(--color-text-secondary)" }}>{label}</p>
      <p style={{ marginTop: 8, fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
        {value}
      </p>
      {sub && <p style={{ ...T.bodyDim, marginTop: 6 }}>{sub}</p>}
    </Card>
  );
}
