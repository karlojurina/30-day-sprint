"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { LESSON_TYPE_LABELS } from "@/lib/constants";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface LessonSheetProps {
  lessonId: string | null;
  onClose: () => void;
}

const WHOP_LESSON_URL = (lessonId: string) =>
  `https://whop.com/joined/ecomtalent/knowledge-KBhMkENW27qoZB/app/courses/cors_6cYEj5qoUcmbcpSryUrfiR/lessons/${lessonId}/`;

/**
 * Centered modal for a single lesson.
 * - watch: embeds the Whop lesson via iframe so students can watch in-app.
 *          Falls back to a "Open in Whop" link if the embed is blocked.
 * - action/setup: description + mark-complete button.
 * - All types: notes textarea (auto-saving).
 */
export function LessonSheet({ lessonId, onClose }: LessonSheetProps) {
  const {
    lessons,
    regions,
    completedLessonIds,
    lessonNotes,
    toggleLesson,
    saveLessonNote,
  } = useStudent();

  const lesson = useMemo(
    () => lessons.find((l) => l.id === lessonId) ?? null,
    [lessons, lessonId]
  );
  const region = useMemo(
    () => (lesson ? regions.find((r) => r.id === lesson.region_id) ?? null : null),
    [regions, lesson]
  );
  const isCompleted = lesson ? completedLessonIds.has(lesson.id) : false;

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, lessonId != null);

  // Close on Escape
  useEffect(() => {
    if (!lessonId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lessonId, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (lessonId) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [lessonId]);

  if (!lesson || !region) return null;

  const isWatch = lesson.type === "watch";
  const hasWhopLesson = Boolean(lesson.whop_lesson_id);
  const whopUrl = hasWhopLesson ? WHOP_LESSON_URL(lesson.whop_lesson_id!) : null;

  return (
    <>
      {/* Backdrop — real button so click-to-close works for keyboard users
          and screen readers, not just mouse. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close lesson"
        className="fixed inset-0 z-[45] cursor-default"
        style={{
          background: "rgba(6,12,26,0.78)",
          backdropFilter: "blur(6px)",
          animation: "overlay-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
          border: "none",
          padding: 0,
        }}
      />

      {/* Centered modal — flex wrapper centers on any viewport, width
          clamps to 92vw so it never overflows on smaller screens. */}
      <div
        className="fixed inset-0 z-[50] flex items-center justify-center p-4"
        style={{ pointerEvents: "none" }}
      >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-sheet-title"
        className="flex flex-col"
        style={{
          pointerEvents: "auto",
          width: "min(840px, 92vw)",
          maxHeight: "92vh",
          background: "linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)",
          border: "1px solid var(--color-border-hover)",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
          animation: "fade-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between p-5 sm:p-6 shrink-0"
          style={{ borderBottom: "1px solid rgba(230,192,122,0.18)" }}
        >
          <div className="min-w-0">
            <p
              className="font-mono uppercase tracking-widest mb-1"
              style={{
                color: "rgba(230,192,122,0.85)",
                letterSpacing: "0.18em",
                fontSize: 11,
              }}
            >
              Day {lesson.day} · {region.name} · {LESSON_TYPE_LABELS[lesson.type]}
            </p>
            <h2
              id="lesson-sheet-title"
              className="italic leading-tight"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-ink)",
                fontWeight: 500,
                fontSize: 28,
              }}
            >
              {lesson.title}
            </h2>
            {lesson.duration_label && (
              <p
                className="font-mono mt-1.5"
                style={{
                  color: "var(--color-ink-dim)",
                  fontSize: 12,
                  letterSpacing: "0.06em",
                }}
              >
                Duration · {lesson.duration_label}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="btn-tinted w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{
              color: "rgba(230,220,200,0.7)",
              border: "1px solid rgba(230,192,122,0.2)",
              background: "transparent",
            }}
            aria-label="Close lesson"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5"
          style={{ overscrollBehavior: "contain" }}
        >
          {/* Watch — "Watch on Whop" card (Whop blocks iframes, so we link out).
              Clicking opens the video in a new tab; auto-sync picks up the
              completion when the student tabs back. */}
          {isWatch && hasWhopLesson && (
            <a
              href={whopUrl!}
              target="_blank"
              rel="noopener"
              className="watch-link relative rounded-lg overflow-hidden flex items-center justify-center group"
              style={{
                aspectRatio: "16 / 9",
                background:
                  "radial-gradient(ellipse 50% 55% at 50% 50%, rgba(77,206,196,0.14) 0%, transparent 70%), linear-gradient(135deg, var(--color-bg-secondary) 0%, var(--color-bg-elevated) 100%)",
                border: "1px solid rgba(230,192,122,0.3)",
                textDecoration: "none",
                transition: "border-color 200ms cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              {/* Subtle scanline texture */}
              <div
                className="absolute inset-0 pointer-events-none opacity-30"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(77,206,196,0.04) 3px, rgba(77,206,196,0.04) 4px)",
                }}
              />
              <div className="relative text-center px-6 z-10">
                <div
                  className="mx-auto mb-4 w-20 h-20 rounded-full flex items-center justify-center transition-transform"
                  style={{
                    background: "rgba(230,192,122,0.22)",
                    border: "2px solid var(--color-gold)",
                    boxShadow: "0 0 40px rgba(230,192,122,0.3)",
                  }}
                >
                  <svg viewBox="0 0 24 24" className="w-9 h-9 ml-1" fill="var(--color-gold-light)">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p
                  className="font-mono uppercase mb-1"
                  style={{
                    color: "var(--color-gold)",
                    letterSpacing: "0.22em",
                    fontSize: 11,
                  }}
                >
                  Watch on Whop
                </p>
                <p
                  className="italic"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "var(--color-ink-dim)",
                    fontSize: 13,
                  }}
                >
                  Opens in a new tab · auto-syncs when you come back
                </p>
              </div>
              {lesson.duration_label && (
                <span
                  className="absolute bottom-3 right-3 font-mono text-[11px] px-2 py-1 rounded"
                  style={{
                    background: "rgba(6,12,26,0.9)",
                    color: "var(--color-gold)",
                    letterSpacing: "0.08em",
                  }}
                >
                  {lesson.duration_label}
                </span>
              )}
            </a>
          )}

          {/* Watch with no Whop link — placeholder */}
          {isWatch && !hasWhopLesson && (
            <div
              className="relative rounded-lg overflow-hidden flex items-center justify-center"
              style={{
                aspectRatio: "16 / 9",
                background: "rgba(6,12,26,0.9)",
                border: "1px solid rgba(230,192,122,0.2)",
              }}
            >
              <div className="text-center px-6">
                <div
                  className="mx-auto mb-3 w-14 h-14 rounded-full flex items-center justify-center"
                  style={{
                    background: "rgba(230,192,122,0.15)",
                    border: "1px solid rgba(230,192,122,0.35)",
                  }}
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="var(--color-gold)">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p
                  className="italic"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "var(--color-ink-dim)",
                    fontSize: 14,
                  }}
                >
                  Video content coming soon.
                </p>
              </div>
            </div>
          )}

          {/* Description */}
          {lesson.description && (
            <p
              className="leading-relaxed"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                color: "rgba(230,220,200,0.88)",
                fontSize: 15,
              }}
            >
              {lesson.description}
            </p>
          )}

          {/* Action / setup — "your mission" block */}
          {!isWatch && (
            <div
              className="p-4 rounded-lg"
              style={{
                background: "rgba(6,12,26,0.55)",
                border: "1px solid rgba(230,192,122,0.16)",
              }}
            >
              <p
                className="font-mono uppercase tracking-widest mb-2"
                style={{
                  color: "var(--color-gold-light)",
                  letterSpacing: "0.18em",
                  fontSize: 11,
                }}
              >
                Your mission
              </p>
              <p style={{ color: "var(--color-ink)", fontSize: 14, lineHeight: 1.6 }}>
                Finish this on your own, then mark it done below.
                {lesson.discord_channel
                  ? " Post your work in Discord when you're ready."
                  : ""}
              </p>
              {lesson.discord_channel && (
                <p className="mt-2 font-mono" style={{ color: "var(--color-gold)", fontSize: 13 }}>
                  #{lesson.discord_channel}
                </p>
              )}
            </div>
          )}

          {/* Action buttons row */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Primary: mark complete (action/setup) OR nothing for watch (watch auto-completes via Whop sync) */}
            {!isWatch && (
              <button
                onClick={() => toggleLesson(lesson.id)}
                className="flex-1 px-6 py-3.5 rounded-lg font-semibold transition-colors"
                style={
                  isCompleted
                    ? {
                        background: "rgba(230,192,122,0.14)",
                        color: "rgba(230,220,200,0.88)",
                        border: "1px solid rgba(230,192,122,0.35)",
                      }
                    : {
                        background: "var(--color-gold)",
                        color: "var(--color-bg-primary)",
                        fontSize: 15,
                      }
                }
              >
                {isCompleted ? "Undo completion" : "Mark complete"}
              </button>
            )}

          </div>

          {/* Lesson notes */}
          <LessonNotes
            lessonId={lesson.id}
            initial={lessonNotes[lesson.id] ?? ""}
            onSave={saveLessonNote}
          />
        </div>
      </div>
      </div>
    </>
  );
}

interface LessonNotesProps {
  lessonId: string;
  initial: string;
  onSave: (lessonId: string, content: string) => Promise<void>;
}

function LessonNotes({ lessonId, initial, onSave }: LessonNotesProps) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initial);

  useEffect(() => {
    setValue(initial);
    lastSaved.current = initial;
  }, [lessonId, initial]);

  const handleChange = useCallback(
    (v: string) => {
      setValue(v);
      if (timer.current) clearTimeout(timer.current);
      if (v.trim() === lastSaved.current.trim()) return;
      setStatus("saving");
      timer.current = setTimeout(async () => {
        await onSave(lessonId, v);
        lastSaved.current = v;
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1600);
      }, 800);
    },
    [lessonId, onSave]
  );

  const notesId = `lesson-notes-${lessonId}`;
  const statusId = `${notesId}-status`;
  return (
    <div
      className="p-4 rounded-lg"
      style={{
        background: "rgba(6,12,26,0.55)",
        border: "1px solid rgba(230,192,122,0.16)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <label
          htmlFor={notesId}
          className="font-mono uppercase tracking-widest"
          style={{
            color: "var(--color-ink-dim)",
            letterSpacing: "0.16em",
            fontSize: 11,
          }}
        >
          Your notes
        </label>
        <span
          id={statusId}
          role="status"
          aria-live="polite"
          className="font-mono"
          style={{
            color: status === "saved" ? "var(--color-gold)" : "var(--color-ink-dim)",
            fontSize: 11,
            minHeight: 14,
          }}
        >
          {status === "saving" ? "saving…" : status === "saved" ? "saved" : ""}
        </span>
      </div>
      <textarea
        id={notesId}
        rows={4}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Write down what stood out, what you'll try next, or anything to remember."
        aria-describedby={statusId}
        className="w-full resize-none outline-none bg-transparent leading-relaxed"
        style={{ color: "var(--color-ink)", fontSize: 14 }}
      />
    </div>
  );
}
