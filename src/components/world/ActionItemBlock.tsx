"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  PASTE_LINK_FIRST,
  actionItemView,
  checkDiscordLink,
  type CompletionHalves,
} from "@/lib/world/action-items";
import u from "@/components/world/world-ui.module.css";

/** Said when the request never got an answer. */
const NO_ANSWER = "Couldn't reach the server. Nothing was saved, so try again.";

/**
 * An action item's hand-in, on the lesson page under the lesson's text (or
 * under the Milestone box when there is no text): the old dashboard's flow
 * (src/components/map/LessonSheet.tsx, DiscordLinkBlock and the "Mark ad
 * shipped" button) in the new page's look.
 *
 *   empty      a field for the Discord message link, and Save
 *   saved      the link (it opens Discord), Edit link, and the complete button
 *   completed  "Completed on <date>." and the link, still editable
 *
 * An error shows under any of them. The link is checked before any request by
 * checkDiscordLink (src/lib/world/action-items.ts), the same rule and message
 * the route answers with. The complete button is there once a link is saved,
 * as in the old app, whether or not the video was watched: on a video lesson
 * it completes the action half and the lesson is done once both halves are
 * (the page says so); on a lesson with no video half it completes the lesson.
 *
 * The state comes from the student's row (`row`), as the context holds it;
 * this component only keeps what is being typed. The caller gives it a `key`
 * per lesson, so nothing typed carries over to the next lesson.
 */
export function ActionItemBlock({
  separateWatchHalf,
  row,
  onSave,
  onComplete,
}: {
  /** The lesson's other half comes from watching its video (a watch lesson). */
  separateWatchHalf: boolean;
  /** The student's completion row for this lesson, or null. */
  row: (CompletionHalves & { discord_message_link?: string | null }) | null;
  /** Save the link. Resolves to null, or to the message to show. */
  onSave: (link: string) => Promise<string | null>;
  /** Complete the action. Resolves to null, or to the message to show. */
  onComplete: () => Promise<string | null>;
}) {
  const view = actionItemView(row, separateWatchHalf);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "complete" | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const ids = useId();
  const headingId = `${ids}-heading`;
  const helpId = `${ids}-help`;
  const stepsId = `${ids}-steps`;
  const errorId = `${ids}-error`;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const completeRef = useRef<HTMLButtonElement | null>(null);
  const editRef = useRef<HTMLButtonElement | null>(null);
  const stateRef = useRef<HTMLParagraphElement | null>(null);
  // Where the keyboard goes once the next render is on screen: the control
  // that was pressed is often gone by then.
  const focusNext = useRef<"input" | "after-save" | "edit" | "state" | null>(null);

  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    const el =
      want === "input"
        ? inputRef.current
        : want === "state"
          ? stateRef.current
          : want === "edit"
            ? editRef.current
            : (completeRef.current ?? editRef.current);
    // preventScroll: a focus must never move the page, whose scroll is the map's camera.
    el?.focus({ preventScroll: true });
  });

  const showForm = view.state === "empty" || editing;
  // On a video lesson whose video is not watched yet, the button completes the action only.
  const completesLesson = !separateWatchHalf || !!row?.completed_at;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const checked = checkDiscordLink(draft);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    if (checked.link === null) {
      // Save pressed with nothing in the field.
      setError(PASTE_LINK_FIRST);
      return;
    }
    if (checked.link === view.link) {
      // Nothing changed: back to the saved link, no request.
      setError(null);
      setEditing(false);
      focusNext.current = "edit";
      return;
    }
    setError(null);
    setBusy("save");
    let failure: string | null;
    try {
      failure = await onSave(checked.link);
    } catch {
      failure = NO_ANSWER;
    }
    setBusy(null);
    if (failure) {
      setError(failure);
      focusNext.current = "input";
      return;
    }
    setEditing(false);
    focusNext.current = "after-save";
  }

  async function complete() {
    if (busy || !view.canComplete) return;
    setError(null);
    setBusy("complete");
    let failure: string | null;
    try {
      failure = await onComplete();
    } catch {
      failure = NO_ANSWER;
    }
    setBusy(null);
    if (failure) {
      setError(failure);
      focusNext.current = "after-save";
      return;
    }
    focusNext.current = "state";
  }

  function edit() {
    setDraft(view.link ?? "");
    setError(null);
    setEditing(true);
    focusNext.current = "input";
  }

  function cancel() {
    setDraft("");
    setError(null);
    setEditing(false);
    focusNext.current = "edit";
  }

  const day = view.completedAt ? dayOf(view.completedAt) : null;

  return (
    <section className={u.submit} aria-labelledby={headingId} data-action-item={view.state}>
      <h2 id={headingId} className={u.submitLabel}>
        Discord link
      </h2>

      {view.state === "completed" && view.completedAt && (
        // Focused after the complete button, which is gone by then. Not a control: no ring.
        <p ref={stateRef} tabIndex={-1} className={u.submitState}>
          <span className={u.doneDot} aria-hidden="true" />
          <span>
            {view.waitingOnVideo ? "Action completed on " : "Completed on "}
            <time dateTime={view.completedAt}>{day}</time>.
            {view.waitingOnVideo && " Watch the video to finish the lesson."}
          </span>
        </p>
      )}

      {showForm ? (
        <>
          {view.state === "empty" && (
            <p id={helpId} className={u.submitHelp}>
              Post your work in Discord, then paste the link to your message here.
            </p>
          )}
          <button
            type="button"
            className={u.stepsToggle}
            aria-expanded={showSteps}
            aria-controls={stepsId}
            onClick={() => setShowSteps((s) => !s)}
          >
            {showSteps ? "Hide the steps" : "How do I get the link?"}
          </button>
          <ol id={stepsId} className={u.steps} hidden={!showSteps}>
            <li>Right-click your message in Discord (on a phone, press and hold it).</li>
            <li>Choose Copy Message Link.</li>
            <li>Paste it here and press Save.</li>
          </ol>
          <form className={u.field} onSubmit={save} noValidate>
            <input
              ref={inputRef}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-labelledby={headingId}
              aria-describedby={[view.state === "empty" ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
              aria-invalid={error ? true : undefined}
              placeholder="https://discord.com/channels/…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={u.input}
            />
            <button type="submit" className={u.primary} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            {editing && (
              <button type="button" className={u.secondary} onClick={cancel} disabled={busy !== null}>
                Cancel
              </button>
            )}
          </form>
        </>
      ) : (
        <div className={u.saved}>
          {view.link ? (
            <>
              {view.state === "saved" && <span className={u.savedNote}>Link saved:</span>}
              <a href={view.link} target="_blank" rel="noopener noreferrer" className={u.savedLink}>
                {view.link.replace(/^https:\/\//, "")}
                <span className="sr-only"> (opens Discord in a new tab)</span>
              </a>
            </>
          ) : (
            <span className={u.savedNote}>No link saved.</span>
          )}
          <button ref={editRef} type="button" className={u.secondary} onClick={edit} disabled={busy !== null}>
            {view.link ? "Edit link" : "Add a link"}
          </button>
        </div>
      )}

      {view.canComplete && !editing && (
        <div className={u.submitActions}>
          <button ref={completeRef} type="button" className={u.primary} onClick={complete} disabled={busy !== null}>
            {busy === "complete" ? "Completing…" : completesLesson ? "Complete lesson" : "Complete the action"}
          </button>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className={u.submitError}>
          <span className={u.errorMark} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </section>
  );
}

/** "Oct 14, 2026", as the old dashboard writes a date. Empty for a value that is not a date. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
