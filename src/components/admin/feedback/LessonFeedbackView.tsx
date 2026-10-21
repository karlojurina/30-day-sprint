"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card, EmptyState, T } from "@/components/admin/ui";
import { FailedMeta, ListHeader, ListPage, LoadError, STALE_TEXT, SkeletonRows, TAP } from "@/components/admin/list-parts";
import { StudentName } from "@/components/admin/student-name";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import type { Answer } from "@/lib/admin/admin-transport";
import { lessonFeedbackTransport } from "@/lib/admin/lesson-feedback-transport";
import type { LessonFeedbackTransport } from "@/lib/admin/lesson-feedback-transport";
import { splitRated } from "@/lib/admin/lesson-feedback";
import type {
  FeedbackAreaRow,
  FeedbackComment,
  FeedbackLessonRow,
  LessonFeedbackView as Payload,
} from "@/lib/admin/lesson-feedback";

/**
 * Lesson feedback, /admin/feedback/lessons (admin rebuild 2, D10 and WI-7),
 * in the brand kit's dark look (admin-tokens.module.css, the parts of
 * list-parts.tsx and ui.tsx).
 *
 * What students said about the video lessons since the course switch:
 *   - three numbers on top: the average of every rating, how many ratings
 *     (and how many with a comment), and how many lessons have one;
 *   - then each area in route order, "01 Introduction", with its own
 *     average and counts, and only its rated lessons, the newest rating
 *     first. A lesson shows its average stars and its count; its comments
 *     follow, newest first: the 3 newest, then "Show all N comments". The
 *     area's lessons with no rating are one muted line, "12 lessons with no
 *     rating yet", that lists them when pressed (admin rebuild 2, the
 *     review's fix round: the page once listed all 135, a wall of "No
 *     ratings yet."). A lesson's id is in its row's title only.
 *
 * Every number comes from GET /api/admin/lesson-feedback, which groups the
 * ratings (buildLessonFeedback, src/lib/admin/lesson-feedback.ts); this file
 * only draws it. A read that fails shows what happened and Retry, never an
 * empty page: no ratings and a failed read must not look the same.
 *
 * The call goes through `transport`, so the dev page
 * /dev/admin/feedback/lessons renders this same component with made-up
 * data and no login.
 *
 * A comment's writer is named as on every admin page (student-name.tsx: a
 * link to the student's page, @username after it; the render review's fix
 * round, where it was a small Airy Blue link).
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: Payload };

/** The comments a lesson shows before "Show all". */
const FIRST_COMMENTS = 3;

/** "4.3": an average, to one decimal. */
const one = (n: number) => n.toFixed(1);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "01": an area's place in route order, as the map numbers its places. */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** The line for ratings of a lesson the catalog read did not have (buildLessonFeedback's `unplaced`). */
function unplacedText(n: number): string {
  const [are, they] = n === 1 ? ["is", "it is"] : ["are", "they are"];
  return `${plural(n, "rating")} ${are} for a lesson the course list didn't have, so ${they} in no count below. Press Refresh; if it stays, the course list needs a look.`;
}

export function LessonFeedbackView({ transport = lessonFeedbackTransport }: { transport?: LessonFeedbackTransport }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [reloading, setReloading] = useState(false);
  /** The last Refresh failed: what is shown may be out of date. */
  const [stale, setStale] = useState(false);
  const seq = useRef(0);

  /** One read. Null when a newer read started meanwhile: that one's answer wins. */
  const fetchPage = useCallback(async (): Promise<Answer<Payload> | null> => {
    const mine = ++seq.current;
    const r = await transport.loadLessonFeedback();
    return mine === seq.current ? r : null;
  }, [transport]);

  useEffect(() => {
    let alive = true;
    void fetchPage().then((r) => {
      if (!alive || !r) return;
      setLoaded(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
    });
    return () => {
      alive = false;
    };
  }, [fetchPage]);

  async function reload() {
    setReloading(true);
    const r = await fetchPage();
    if (!r) return;
    setReloading(false);
    if (r.ok) {
      setLoaded({ kind: "ready", data: r.data });
      setStale(false);
      return;
    }
    // A page already shown stays, with one line saying it may be out of date.
    if (loaded.kind === "ready") setStale(true);
    else setLoaded({ kind: "error", error: r.error });
  }

  const header = (meta: React.ReactNode, action?: React.ReactNode) => (
    <ListHeader
      title="Lesson feedback"
      description="What students say about the video lessons, by area. A student can rate a lesson once they have finished it."
      meta={meta}
      action={action}
    />
  );

  // The header keeps its Refresh while the page loads or failed, so it never jumps (the review's fix round).
  const refreshButton = (
    <Button variant="raised" size="md" busy={reloading || loaded.kind === "loading"} disabled={loaded.kind === "loading"} onClick={() => void reload()}>
      Refresh
    </Button>
  );
  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading", refreshButton)}
        <SkeletonRows rows={4} label="Loading the lesson ratings" />
      </ListPage>
    );
  }

  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(<FailedMeta />, refreshButton)}
        <LoadError title="Couldn't load lesson feedback." detail={loaded.error} onRetry={() => void reload()} busy={reloading} />
      </ListPage>
    );
  }

  const data = loaded.data;
  const { totals } = data;
  const since = data.since ? `Since ${dayLabel(data.since)}` : "Every rating";
  const updated = `Updated ${clockLabel(data.generatedAt)}${reloading ? " · Updating" : ""}`;

  return (
    <ListPage>
      {header(`${since} · ${updated}`, refreshButton)}

      {stale && <Warning>{STALE_TEXT}</Warning>}
      {data.unplaced > 0 && <Warning>{unplacedText(data.unplaced)}</Warning>}

      <Card padding={0} style={{ marginBottom: 32 }}>
        <dl className="grid grid-cols-3">
          <Figure
            label="Average"
            value={totals.average === null ? "None yet" : `${one(totals.average)} of 5`}
            note={totals.ratings === 0 ? "No rating yet" : `From ${plural(totals.ratings, "rating")}`}
          />
          <Figure label="Ratings" value={String(totals.ratings)} note={`${totals.comments} with a comment`} />
          <Figure label="Lessons rated" value={`${totals.lessonsRated} of ${totals.lessons}`} note="Video lessons with a rating" />
        </dl>
      </Card>

      {totals.ratings === 0 ? (
        <Card>
          <EmptyState
            title="No ratings yet."
            description={
              data.since
                ? `Counting from ${dayLabel(data.since)}, when the new course started. Ratings show here as students give them.`
                : "Ratings show here as students give them."
            }
          />
        </Card>
      ) : (
        data.areas.map((area) => <AreaSection key={area.id} area={area} />)
      )}
    </ListPage>
  );
}

/**
 * One of the three numbers on top: side by side in one card with a hairline
 * between them, on a phone too (smaller there), so they never stack into a
 * column of their own.
 */
function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="p-3 sm:p-4 [&:not(:first-child)]:border-l" style={{ borderColor: "var(--color-border)", minWidth: 0 }}>
      <dt style={T.eyebrow}>{label}</dt>
      <dd
        className="stat-value text-[20px] sm:text-[28px]"
        style={{
          marginTop: 8,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "-0.024em",
          color: "var(--color-text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </dd>
      <dd style={{ ...T.meta, marginTop: 6, lineHeight: 1.4 }}>{note}</dd>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex"
      style={{
        gap: 10,
        alignItems: "flex-start",
        marginBottom: 16,
        padding: "10px 14px",
        borderRadius: "var(--radius-control)",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-card)",
      }}
    >
      <span
        aria-hidden="true"
        style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: "var(--color-warning)" }}
      />
      <p style={{ ...T.body, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

function AreaSection({ area }: { area: FeedbackAreaRow }) {
  const headingId = useId();
  const { rated, unrated } = splitRated(area.lessons);
  const summary =
    area.ratings === 0
      ? "No ratings yet"
      : `${one(area.average ?? 0)} average · ${plural(area.ratings, "rating")} · ${area.lessonsRated} of ${area.lessons.length} lessons rated`;
  return (
    <section aria-labelledby={headingId} style={{ marginBottom: 32 }}>
      <div className="flex flex-wrap items-baseline justify-between" style={{ gap: "4px 16px", marginBottom: 12 }}>
        <h2 id={headingId} style={{ ...T.heading, display: "flex", gap: 10, alignItems: "baseline" }}>
          {area.number !== null && (
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
              {pad2(area.number)}
            </span>
          )}{" "}
          <span>{area.name}</span>
        </h2>
        <p style={{ ...T.bodyDim, fontVariantNumeric: "tabular-nums" }}>{summary}</p>
      </div>
      <Card padding={0}>
        {rated.length > 0 && (
          <ul>
            {rated.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} />
            ))}
          </ul>
        )}
        <UnratedLine lessons={unrated} alone={rated.length === 0} />
      </Card>
    </section>
  );
}

/**
 * The area's lessons with no rating, as one muted line: "12 lessons with no
 * rating yet", which lists their titles when pressed. Their ids are in the
 * titles' title attribute, for the team.
 */
function UnratedLine({ lessons, alone }: { lessons: FeedbackLessonRow[]; alone: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (lessons.length === 0) return null;
  return (
    <div className="list-row" data-unrated={lessons.length} style={{ flexDirection: "column", alignItems: "stretch", padding: "0 16px", borderTop: alone ? "none" : "1px solid var(--color-border)" }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between"
        style={{
          minHeight: TAP,
          gap: 12,
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          ...T.bodyDim,
        }}
      >
        <span>
          {plural(lessons.length, "lesson")} with no rating yet
        </span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ flex: "none", transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}>
          <path d="M4 6l4 4 4-4" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul id={listId} className="flex flex-col" style={{ gap: 6, padding: "0 0 14px" }}>
          {lessons.map((l) => (
            <li key={l.id} data-lesson={l.id} title={l.id} style={{ ...T.bodyDim, lineHeight: 1.5, overflowWrap: "anywhere" }}>
              {l.title}
              {!l.rateable && <span style={{ fontSize: 12 }}> · students can&apos;t rate this lesson now</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LessonRow({ lesson }: { lesson: FeedbackLessonRow }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const shown = all ? lesson.comments : lesson.comments.slice(0, FIRST_COMMENTS);
  const more = lesson.comments.length - FIRST_COMMENTS;

  return (
    <li
      className="list-row"
      data-lesson={lesson.id}
      title={lesson.id}
      style={{ flexDirection: "column", alignItems: "stretch", gap: 12, padding: 16 }}
    >
      <div className="flex flex-wrap items-baseline justify-between" style={{ gap: "6px 16px" }}>
        <p style={{ ...T.cardTitle, flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere" }}>
          {lesson.title}
          {!lesson.rateable && (
            <span style={{ ...T.meta, fontSize: 12, fontWeight: 400, marginLeft: 8 }}>students can&apos;t rate this lesson now</span>
          )}
        </p>
        <p className="flex items-center" style={{ gap: 10, flex: "none" }}>
          <Stars value={lesson.average ?? 0} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {one(lesson.average ?? 0)}
            <span className="sr-only"> average out of 5</span>
          </span>
          <span style={{ ...T.bodyDim, fontVariantNumeric: "tabular-nums" }}>{plural(lesson.ratings, "rating")}</span>
        </p>
      </div>

      {shown.length > 0 && (
        <ul id={listId} aria-label={`Comments on ${lesson.title}, newest first`} className="flex flex-col" style={{ gap: 8 }}>
          {shown.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </ul>
      )}
      {more > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
            style={{
              minHeight: TAP,
              padding: "0 16px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-primary)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {all ? "Show fewer" : `Show all ${lesson.comments.length} comments`}
          </button>
        </div>
      )}
    </li>
  );
}

function CommentItem({ comment }: { comment: FeedbackComment }) {
  const who = comment.student;
  const name = who?.name?.trim() || who?.email || "A student no longer on file";
  return (
    <li
      style={{
        padding: "12px 14px",
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
      }}
    >
      <div className="flex flex-wrap items-baseline" style={{ gap: "4px 10px", marginBottom: 6 }}>
        <Stars value={comment.stars} small />
        <span className="sr-only">{comment.stars} of 5 stars.</span>
        <StudentName id={who?.id} name={name} username={who?.discord_username} size={13} />
        <span style={{ ...T.bodyDim, fontSize: 12 }}>{dayLabel(comment.at)}</span>
      </div>
      <p style={{ ...T.body, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.comment}</p>
    </li>
  );
}

const STAR_PATH = "M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.13 6.38 20.1l1.07-6.27L2.9 9.4l6.3-.9z";

/**
 * Five stars for a value, to the nearest half: Stalactite for what is lit,
 * the 20% hairline for the rest, so an average of 4.5 shows four and a half,
 * never five. Decoration only (aria-hidden): the number beside it, or the
 * screen reader's line, says the value.
 */
function Stars({ value, small = false }: { value: number; small?: boolean }) {
  const clip = useId();
  const size = small ? 12 : 14;
  const halves = Math.round(value * 2);
  return (
    <span aria-hidden="true" className="inline-flex" style={{ gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = halves >= n * 2 ? "full" : halves === n * 2 - 1 ? "half" : "none";
        return (
          <svg key={n} width={size} height={size} viewBox="0 0 24 24" strokeWidth="1.8" strokeLinejoin="round" data-lit={lit}>
            {lit === "half" && (
              <defs>
                <clipPath id={`${clip}-half`}>
                  <rect x="0" y="0" width="12" height="24" />
                </clipPath>
              </defs>
            )}
            <path
              d={STAR_PATH}
              fill={lit === "full" ? "var(--color-text-primary)" : "none"}
              stroke={lit === "none" ? "var(--color-border-strong)" : "var(--color-text-primary)"}
            />
            {lit === "half" && <path d={STAR_PATH} fill="var(--color-text-primary)" clipPath={`url(#${clip}-half)`} />}
          </svg>
        );
      })}
    </span>
  );
}
