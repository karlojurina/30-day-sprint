"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useStudent } from "@/contexts/StudentContext";

const WEEK_PROMPTS: Record<number, string> = {
  1: "What\u2019s one thing from this lesson that surprised you?",
  2: "What\u2019s one thing you\u2019d do differently in your ads after watching this?",
  3: "What pattern are you starting to notice in winning ads?",
  4: "What\u2019s the hardest part of bounty work so far?",
};

interface LessonNoteInputProps {
  taskId: string;
  week: number;
}

export function LessonNoteInput({ taskId, week }: LessonNoteInputProps) {
  const { lessonNotes, saveLessonNote } = useStudent();
  const [value, setValue] = useState(lessonNotes[taskId] ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(lessonNotes[taskId] ?? "");

  // Sync if context updates externally
  useEffect(() => {
    const contextVal = lessonNotes[taskId] ?? "";
    if (contextVal !== lastSavedRef.current) {
      setValue(contextVal);
      lastSavedRef.current = contextVal;
    }
  }, [lessonNotes, taskId]);

  const handleChange = useCallback(
    (newValue: string) => {
      setValue(newValue);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const trimmed = newValue.trim();
      if (trimmed === lastSavedRef.current.trim()) return;

      setSaveStatus("saving");
      debounceRef.current = setTimeout(async () => {
        await saveLessonNote(taskId, newValue);
        lastSavedRef.current = newValue;
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1800);
      }, 900);
    },
    [taskId, saveLessonNote]
  );

  const prompt = WEEK_PROMPTS[week] ?? WEEK_PROMPTS[1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
      className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="mono-label">Your notes</span>
        {saveStatus === "saving" && (
          <span className="mono-label text-[var(--color-text-quaternary)]">
            saving&hellip;
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="mono-label-accent">saved</span>
        )}
      </div>

      <p className="text-[12px] text-[var(--color-text-tertiary)] mb-2 italic">
        {prompt}
      </p>

      <textarea
        rows={3}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Write your thoughts here..."
        className="
          w-full resize-none bg-transparent
          text-[14px] text-[var(--color-text-primary)]
          placeholder:text-[var(--color-text-quaternary)]
          outline-none leading-relaxed
        "
      />
    </motion.div>
  );
}
