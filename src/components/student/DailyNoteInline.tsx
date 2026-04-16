"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useStudent } from "@/contexts/StudentContext";

export function DailyNoteInline() {
  const { todayNote, saveNote } = useStudent();
  const [content, setContent] = useState(todayNote?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setContent(todayNote?.content ?? "");
  }, [todayNote]);

  // Debounced autosave
  useEffect(() => {
    if (content === (todayNote?.content ?? "")) return;
    if (content.trim() === "") return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      await saveNote(content);
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }, 900);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [content, saveNote, todayNote]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto max-w-[560px] px-4"
    >
      <div className="relative rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <span className="mono-label">Today&apos;s note</span>
          <motion.span
            key={saving ? "saving" : saved ? "saved" : "idle"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className={`mono-label ${saved ? "text-[var(--color-accent)]" : ""}`}
          >
            {saving ? "saving…" : saved ? "saved" : ""}
          </motion.span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What did you work on today?"
          rows={3}
          className="
            w-full bg-transparent border-0 outline-0 resize-none
            text-[15px] leading-relaxed text-[var(--color-text-primary)]
            placeholder:text-[var(--color-text-tertiary)]
          "
        />
      </div>
    </motion.div>
  );
}
