"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card, EmptyState, T } from "@/components/admin/ui";
import { ListHeader, ListPage, LoadError, STALE_TEXT, SkeletonRows, TAP } from "@/components/admin/list-parts";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import type { Answer } from "@/lib/admin/admin-transport";
import { lessonFeedbackTransport } from "@/lib/admin/lesson-feedback-transport";
import type { LessonFeedbackTransport } from "@/lib/admin/lesson-feedback-transport";
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
 *     average and counts, and its lessons in course order. A lesson shows
 *     its average stars and its count, or "No ratings yet."; its comments
 *     follow, newest first: the 3 newest, then "Show all N comments". An
 *     area where no lesson has a rating says so in one line instead.
 *
 * Every number comes from GET /api/admin/lesson-feedback, which groups the
 * ratings (buildLessonFeedback, src/lib/admin/lesson-feedback.ts); this file
 * only draws it. A read that fails shows what happened and Retry, never an
 * empty page: no ratings and a failed read must not look the same.
 *
 * The call goes through `transport`, so the dev page
 * /dev/admin/feedback/lessons renders this same component with made-up
 * data and no login.
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

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading")}
        <SkeletonRows rows={4} label="Loading the lesson ratings" />
      </ListPage>
    );
  }

  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null)}
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
      {header(
        `${since} · ${updated}`,
        <Button variant="raised" size="md" busy={reloading} onClick={() => void reload()}>
          Refresh
        </Button>,
      )}

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
      {area.ratings === 0 ? (
        <Card>
          <p style={T.bodyDim}>No lesson in this area has a rating yet.</p>
        </Card>
      ) : (
        <Card padding={0}>
          <ul>
            {area.lessons.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** The lesson's id beside its title, quiet: the course's own name for it. */
function LessonId({ lesson }: { lesson: FeedbackLessonRow }) {
  return (
    <span style={{ ...T.meta, fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
      <span style={{ whiteSpace: "nowrap" }}>{lesson.id}</span>
      {!lesson.rateable && " · students can't rate this lesson now"}
    </span>
  );
}

function LessonRow({ lesson }: { lesson: FeedbackLessonRow }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const shown = all ? lesson.comments : lesson.comments.slice(0, FIRST_COMMENTS);
  const more = lesson.comments.length - FIRST_COMMENTS;

  // A lesson with no rating: one quiet line, so a long area stays easy to scan.
  if (lesson.ratings === 0 || lesson.average === null) {
    return (
      <li
        className="list-row"
        data-lesson={lesson.id}
        style={{ flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "2px 16px", padding: "11px 16px" }}
      >
        <p style={{ ...T.body, fontWeight: 500, flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>
          {lesson.title}
          <LessonId lesson={lesson} />
        </p>
        <p style={{ ...T.bodyDim, flex: "none" }}>No ratings yet.</p>
      </li>
    );
  }

  return (
    <li
      className="list-row"
      data-lesson={lesson.id}
      style={{ flexDirection: "column", alignItems: "stretch", gap: 12, padding: 16 }}
    >
      <div className="flex flex-wrap items-baseline justify-between" style={{ gap: "6px 16px" }}>
        <p style={{ ...T.cardTitle, flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere" }}>
          {lesson.title}
          <LessonId lesson={lesson} />
        </p>
        <p className="flex items-center" style={{ gap: 10, flex: "none" }}>
          <Stars value={lesson.average} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {one(lesson.average)}
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
      <div className="flex flex-wrap items-center" style={{ gap: "4px 10px", marginBottom: 6 }}>
        <Stars value={comment.stars} small />
        <span className="sr-only">{comment.stars} of 5 stars.</span>
        <span style={{ ...T.bodyDim, fontSize: 12 }}>
          {who ? (
            <Link href={`/admin/students/${encodeURIComponent(who.id)}`} style={{ color: "var(--color-accent-dark)", textDecoration: "none" }}>
              {name}
            </Link>
          ) : (
            name
          )}
          {" · "}
          {dayLabel(comment.at)}
        </span>
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
