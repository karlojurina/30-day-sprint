"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { RATING_COMMENT_MAX } from "@/lib/world/lesson-rating";
import u from "@/components/world/world-ui.module.css";
import r from "@/components/world/lesson-rating.module.css";

/** Said when saving threw instead of answering. */
const NO_ANSWER = "Couldn't reach the server. Nothing was saved, so try again.";

/** The counter under the comment shows once this many characters or fewer are left. */
const COUNT_FROM = 100;

const STARS = [1, 2, 3, 4, 5] as const;

export interface SavedRating {
  stars: number;
  comment: string | null;
}

/**
 * "How was this lesson?" on the lesson page, under Done. and Next lesson
 * (admin rebuild 2, D10). LessonScreen.tsx shows it only for a lesson the
 * student can rate (ratingRefusal in src/lib/world/lesson-rating.ts: a video
 * lesson, not the Ad Bounty's, finished as the map counts it), and keys it
 * per lesson, so nothing picked or typed carries over to the next one.
 *
 *   empty    the question and five stars
 *   picking  a star is picked: the comment (optional, at most 1000
 *            characters), Save and Cancel
 *   saved    the stars given, "You rated it 4 of 5.", Edit, and the comment
 *   editing  the saved rating in the form again, with Save and Cancel
 *
 * The stars are a radio group: Tab reaches it, the arrow keys move the pick,
 * a screen reader hears "4 stars, 4 of 5, selected". Each star is a 40px box,
 * 44px on a phone. Nothing is sent until Save; the save waits for the server
 * (StudentContext's rateLesson), and only a saved rating comes back in
 * `saved`. A refusal shows under the buttons in the route's own words, with
 * what was picked and typed kept.
 *
 * While the form is open (stars picked, or editing), `onFormOpen(true)`: the
 * lesson page then draws "Next lesson" outlined, so Save is the one filled
 * button in the panel (admin rebuild 2, the review's fix round).
 */
export function LessonRating({
  saved,
  onSave,
  onFormOpen,
}: {
  /** The student's saved rating of this lesson, or null. */
  saved: SavedRating | null;
  /** Save a rating. Resolves to null once saved, or to the sentence to show. */
  onSave: (stars: number, comment: string | null) => Promise<string | null>;
  /** Told whether the form with Save is open; false again when the block goes. */
  onFormOpen?: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [preview, setPreview] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ids = useId();
  const headingId = `${ids}-heading`;
  const commentId = `${ids}-comment`;
  const countId = `${ids}-count`;
  const errorId = `${ids}-error`;

  const radios = useRef<(HTMLInputElement | null)[]>([]);
  const saveRef = useRef<HTMLButtonElement | null>(null);
  const editRef = useRef<HTMLButtonElement | null>(null);
  const savedRef = useRef<HTMLParagraphElement | null>(null);
  // Where the keyboard goes once the next render is on screen: the control
  // that was pressed is often gone by then.
  const focusNext = useRef<"saved" | "edit" | "save" | "stars" | null>(null);

  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    const el =
      want === "saved"
        ? savedRef.current
        : want === "edit"
          ? editRef.current
          : want === "save"
            ? saveRef.current
            : (radios.current[Math.max(0, stars - 1)] ?? null);
    // preventScroll: a focus must never move the page, whose scroll is the map's camera.
    el?.focus({ preventScroll: true });
  });

  const showForm = !saved || editing;
  const left = RATING_COMMENT_MAX - comment.length;
  const formOpen = showForm && stars > 0;
  useEffect(() => {
    onFormOpen?.(formOpen);
  }, [formOpen, onFormOpen]);
  useEffect(() => () => onFormOpen?.(false), [onFormOpen]);

  function pick(n: number) {
    setStars(n);
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || stars < 1) return;
    const text = comment.trim();
    if (saved && editing && stars === saved.stars && text === (saved.comment ?? "")) {
      // Nothing changed: back to the saved rating, no request.
      setEditing(false);
      setError(null);
      focusNext.current = "edit";
      return;
    }
    setError(null);
    setBusy(true);
    let failure: string | null;
    try {
      failure = await onSave(stars, text === "" ? null : text);
    } catch {
      failure = NO_ANSWER;
    }
    setBusy(false);
    if (failure) {
      setError(failure);
      focusNext.current = "save";
      return;
    }
    setEditing(false);
    focusNext.current = "saved";
  }

  function edit() {
    if (!saved) return;
    setStars(saved.stars);
    setComment(saved.comment ?? "");
    setError(null);
    setEditing(true);
    focusNext.current = "stars";
  }

  function cancel() {
    setError(null);
    setPreview(0);
    if (saved) {
      setEditing(false);
      focusNext.current = "edit";
      return;
    }
    setStars(0);
    setComment("");
    focusNext.current = "stars";
  }

  if (!showForm && saved) {
    return (
      <section className={r.block} aria-labelledby={headingId} data-rating="saved">
        <div className={r.top}>
          <h2 id={headingId} className={r.question}>
            How was this lesson?
          </h2>
          <p ref={savedRef} tabIndex={-1} className={r.savedLine}>
            <span className={r.shownStars} aria-hidden="true">
              {STARS.map((n) => (
                <StarIcon key={n} lit={n <= saved.stars} />
              ))}
            </span>
            <span>You rated it {saved.stars} of 5.</span>
          </p>
          <button ref={editRef} type="button" className={`${u.secondary} ${r.tall}`} onClick={edit}>
            Edit
          </button>
        </div>
        {saved.comment && <p className={r.savedComment}>{saved.comment}</p>}
      </section>
    );
  }

  const lit = preview || stars;
  return (
    <section className={r.block} aria-labelledby={headingId} data-rating={editing ? "editing" : stars > 0 ? "picking" : "empty"}>
      <form onSubmit={save} noValidate>
        <div className={r.top}>
          <h2 id={headingId} className={r.question}>
            How was this lesson?
          </h2>
          <div
            role="radiogroup"
            aria-labelledby={headingId}
            className={r.stars}
            onPointerLeave={() => setPreview(0)}
          >
            {STARS.map((n) => (
              <label
                key={n}
                className={r.star}
                data-lit={n <= lit ? "" : undefined}
                data-off={busy ? "" : undefined}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse" && !busy) setPreview(n);
                }}
              >
                <input
                  ref={(el) => {
                    radios.current[n - 1] = el;
                  }}
                  type="radio"
                  name={`${ids}-stars`}
                  value={n}
                  checked={stars === n}
                  disabled={busy}
                  onChange={() => pick(n)}
                  aria-label={n === 1 ? "1 star" : `${n} stars`}
                  className={r.radio}
                />
                <span className={r.box}>
                  <StarIcon lit={n <= lit} />
                </span>
              </label>
            ))}
          </div>
          {stars > 0 && (
            <span className={r.picked} aria-hidden="true">
              {stars} of 5
            </span>
          )}
        </div>

        {stars > 0 && (
          <>
            <label htmlFor={commentId} className={r.commentLabel}>
              Comment (optional)
            </label>
            <textarea
              id={commentId}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={RATING_COMMENT_MAX}
              rows={3}
              placeholder="What worked, and what didn't?"
              disabled={busy}
              aria-describedby={[left <= COUNT_FROM ? countId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
              className={r.textarea}
            />
            <div className={r.actions}>
              <button ref={saveRef} type="submit" className={`${u.primary} ${r.tall}`} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className={`${u.secondary} ${r.tall}`} onClick={cancel} disabled={busy}>
                Cancel
              </button>
              {left <= COUNT_FROM && (
                <p id={countId} className={r.counter}>
                  {left === 1 ? "1 character left" : `${left} characters left`}
                </p>
              )}
            </div>
          </>
        )}

        {error && (
          <p id={errorId} role="alert" className={r.error}>
            <span className={r.errorMark} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </form>
    </section>
  );
}

/** A five-pointed star: filled in the accent when lit, an outline otherwise. */
function StarIcon({ lit }: { lit: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-lit={lit ? "" : undefined}
      fill={lit ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.13 6.38 20.1l1.07-6.27L2.9 9.4l6.3-.9z" />
    </svg>
  );
}
