"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useStudent } from "@/contexts/StudentContext";
import type { Lesson } from "@/types/database";
import { LESSON_TYPE_LABELS } from "@/lib/constants";

interface LessonSheetProps {
  lessonId: string | null;
  onClose: () => void;
}

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";

/**
 * Right-side drawer with full lesson details: video placeholder (watch),
 * action checklist (action/setup), mark-complete toggle, lesson notes textarea.
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

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(6,12,26,0.68)",
          backdropFilter: "blur(4px)",
          zIndex: 40,
          animation: "overlay-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      />

      {/* Sheet */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          maxWidth: 440,
          background: "#102042",
          borderLeft: "1px solid rgba(230,192,122,0.2)",
          zIndex: 50,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "sheet-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-5"
          style={{ borderBottom: "1px solid rgba(230,192,122,0.14)" }}
        >
          <div>
            <p
              className="text-[10px] font-mono uppercase tracking-widest"
              style={{ color: "rgba(230,192,122,0.85)", letterSpacing: "0.16em" }}
            >
              Day {lesson.day} · {region.name} · {LESSON_TYPE_LABELS[lesson.type]}
            </p>
            <h2
              className="italic text-[24px] mt-1 leading-tight"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                color: "#E6DCC8",
              }}
            >
              {lesson.title}
            </h2>
            {lesson.duration_label && (
              <p
                className="text-[12px] font-mono mt-1"
                style={{ color: "rgba(230,220,200,0.42)" }}
              >
                {lesson.duration_label}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{
              color: "rgba(230,220,200,0.62)",
              background: "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(230,192,122,0.08)")}
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
          className="flex-1 overflow-y-auto p-5 space-y-5"
          style={{ overscrollBehavior: "contain" }}
        >
          {/* Video placeholder for watch */}
          {lesson.type === "watch" && (
            <div
              className="relative rounded-lg overflow-hidden"
              style={{
                aspectRatio: "16 / 9",
                background: "rgba(6,12,26,0.9)",
                border: "1px solid rgba(230,192,122,0.2)",
              }}
            >
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  background:
                    "radial-gradient(ellipse 40% 50% at 50% 50%, rgba(230,192,122,0.15), transparent)",
                }}
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{
                    background: "rgba(230,192,122,0.2)",
                    border: "1.5px solid #E6C07A",
                  }}
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill={GOLD}>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              <p
                className="absolute bottom-3 right-3 text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded"
                style={{
                  background: "rgba(6,12,26,0.85)",
                  color: GOLD,
                  letterSpacing: "0.12em",
                }}
              >
                {lesson.duration_label ?? "—"}
              </p>
            </div>
          )}

          {/* Description */}
          {lesson.description && (
            <p
              className="text-[14px] leading-relaxed"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                fontStyle: "italic",
                color: "rgba(230,220,200,0.85)",
              }}
            >
              {lesson.description}
            </p>
          )}

          {/* Action info (for action/setup) */}
          {lesson.type !== "watch" && (
            <div
              className="p-4 rounded-lg"
              style={{
                background: "rgba(6,12,26,0.5)",
                border: "1px solid rgba(230,192,122,0.12)",
              }}
            >
              <p
                className="text-[11px] font-mono uppercase tracking-widest mb-2"
                style={{ color: GOLD_HI, letterSpacing: "0.16em" }}
              >
                Your mission
              </p>
              <p className="text-[13px]" style={{ color: "#E6DCC8" }}>
                Complete this on your own, then mark it done below. Post in
                Discord if there&apos;s a channel linked.
              </p>
              {lesson.discord_channel && (
                <p className="mt-2 text-[12px] font-mono" style={{ color: GOLD }}>
                  #{lesson.discord_channel}
                </p>
              )}
            </div>
          )}

          {/* Open in Whop (watch) */}
          {lesson.type === "watch" && lesson.whop_lesson_id && (
            <a
              href={`https://whop.com/joined/ecomtalent/knowledge-KBhMkENW27qoZB/app/courses/cors_6cYEj5qoUcmbcpSryUrfiR/lessons/${lesson.whop_lesson_id}/`}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-center gap-2 w-full px-6 py-3 rounded-lg font-semibold text-[14px] transition-colors"
              style={{
                background: GOLD,
                color: "#060C1A",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = GOLD_HI)}
              onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Open lesson in Whop
            </a>
          )}

          {/* Mark complete toggle (non-watch) */}
          {lesson.type !== "watch" && (
            <button
              onClick={() => {
                toggleLesson(lesson.id);
              }}
              className="w-full px-6 py-3 rounded-lg font-semibold text-[14px] transition-colors"
              style={
                isCompleted
                  ? {
                      background: "rgba(230,192,122,0.12)",
                      color: "rgba(230,220,200,0.85)",
                      border: "1px solid rgba(230,192,122,0.32)",
                    }
                  : {
                      background: GOLD,
                      color: "#060C1A",
                    }
              }
            >
              {isCompleted ? "Undo completion" : "Mark complete"}
            </button>
          )}

          {/* Notes */}
          <LessonNotes
            lessonId={lesson.id}
            initial={lessonNotes[lesson.id] ?? ""}
            onSave={saveLessonNote}
          />
        </div>
      </aside>
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
        background: "rgba(6,12,26,0.5)",
        border: "1px solid rgba(230,192,122,0.12)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <p
          className="text-[11px] font-mono uppercase tracking-widest"
          style={{ color: "rgba(230,220,200,0.42)", letterSpacing: "0.14em" }}
        >
          Your notes
        </p>
        {status === "saving" && (
          <span
            className="text-[10px] font-mono"
            style={{ color: "rgba(230,220,200,0.42)" }}
          >
            saving…
          </span>
        )}
        {status === "saved" && (
          <span
            className="text-[10px] font-mono"
            style={{ color: GOLD }}
          >
            saved
          </span>
        )}
      </div>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Write down what stood out, what you'll try next, or anything to remember."
        className="w-full resize-none outline-none bg-transparent text-[13px] leading-relaxed"
        style={{ color: "#E6DCC8" }}
      />
    </div>
  );
}
