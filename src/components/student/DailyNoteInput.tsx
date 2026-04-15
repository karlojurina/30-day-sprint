"use client";

import { useState, useEffect } from "react";
import { useStudent } from "@/contexts/StudentContext";

export function DailyNoteInput() {
  const { todayNote, saveNote } = useStudent();
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (todayNote?.content) {
      setContent(todayNote.content);
    }
  }, [todayNote]);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    await saveNote(content.trim());
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold">Daily Notes</h3>
      <p className="text-xs text-text-secondary">
        What did you learn today? What&apos;s one thing you&apos;ll do
        differently tomorrow?
      </p>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your notes for today..."
        rows={4}
        className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors resize-none"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          {content.length} characters
        </span>
        <button
          onClick={handleSave}
          disabled={saving || !content.trim()}
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent hover:bg-accent-dark transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save"}
        </button>
      </div>
    </div>
  );
}
