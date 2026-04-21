"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { LESSON_TYPE_LABELS } from "@/lib/constants";

interface LessonSheetProps {
  lessonId: string | null;
  onClose: () => void;
}

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";

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
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[45]"
        style={{
          background: "rgba(6,12,26,0.78)",
          backdropFilter: "blur(6px)",
          animation: "overlay-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      />

      {/* Centered modal */}
      <div
        className="fixed z-[50] flex flex-col"
        style={{
          top: "4%",
          bottom: "4%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(960px, 94vw)",
          background: "linear-gradient(180deg, #102042 0%, #0A1428 100%)",
          border: "1px solid rgba(230,192,122,0.32)",
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
              className="italic leading-tight"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                color: "#E6DCC8",
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
                  color: "rgba(230,220,200,0.5)",
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
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0"
            style={{
              color: "rgba(230,220,200,0.62)",
              border: "1px solid rgba(230,192,122,0.2)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(230,192,122,0.08)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            aria-label="Close"
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
          {/* Watch — embedded Whop player */}
          {isWatch && hasWhopLesson && (
            <div
              className="relative rounded-lg overflow-hidden"
              style={{
                aspectRatio: "16 / 9",
                background: "#000",
                border: "1px solid rgba(230,192,122,0.2)",
              }}
            >
              <iframe
                src={whopUrl!}
                title={lesson.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                }}
              />
            </div>
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
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill={GOLD}>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p
                  className="italic"
                  style={{
                    fontFamily: "Cormorant Garamond, serif",
                    color: "rgba(230,220,200,0.72)",
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
                fontFamily: "Cormorant Garamond, serif",
                fontStyle: "italic",
                color: "rgba(230,220,200,0.85)",
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
                  color: GOLD_HI,
                  letterSpacing: "0.18em",
                  fontSize: 11,
                }}
              >
                Your mission
              </p>
              <p style={{ color: "#E6DCC8", fontSize: 14, lineHeight: 1.6 }}>
                Finish this on your own, then mark it done below.
                {lesson.discord_channel
                  ? " Post your work in Discord when you're ready."
                  : ""}
              </p>
              {lesson.discord_channel && (
                <p className="mt-2 font-mono" style={{ color: GOLD, fontSize: 13 }}>
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
                        background: GOLD,
                        color: "#060C1A",
                        fontSize: 15,
                      }
                }
              >
                {isCompleted ? "Undo completion" : "Mark complete"}
              </button>
            )}

            {/* Secondary/fallback: open in Whop (small button, lower priority) */}
            {isWatch && whopUrl && (
              <a
                href={whopUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg transition-colors self-start"
                style={{
                  background: "rgba(16,32,66,0.7)",
                  color: "rgba(230,220,200,0.85)",
                  border: "1px solid rgba(230,192,122,0.22)",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(230,192,122,0.5)";
                  e.currentTarget.style.color = "#E6DCC8";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(230,192,122,0.22)";
                  e.currentTarget.style.color = "rgba(230,220,200,0.85)";
                }}
                title="Open in a new tab on Whop (fallback if embed fails)"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                <span className="font-mono uppercase" style={{ letterSpacing: "0.12em", fontSize: 10 }}>
                  Open in Whop
                </span>
              </a>
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

  return (
    <div
      className="p-4 rounded-lg"
      style={{
        background: "rgba(6,12,26,0.55)",
        border: "1px solid rgba(230,192,122,0.16)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <p
          className="font-mono uppercase tracking-widest"
          style={{
            color: "rgba(230,220,200,0.5)",
            letterSpacing: "0.16em",
            fontSize: 11,
          }}
        >
          Your notes
        </p>
        {status === "saving" && (
          <span className="font-mono" style={{ color: "rgba(230,220,200,0.42)", fontSize: 10 }}>
            saving…
          </span>
        )}
        {status === "saved" && (
          <span className="font-mono" style={{ color: GOLD, fontSize: 10 }}>
            saved
          </span>
        )}
      </div>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Write down what stood out, what you'll try next, or anything to remember."
        className="w-full resize-none outline-none bg-transparent leading-relaxed"
        style={{ color: "#E6DCC8", fontSize: 14 }}
      />
    </div>
  );
}
