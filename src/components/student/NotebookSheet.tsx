"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";

interface NotebookSheetProps {
  open: boolean;
  onClose: () => void;
}

export function NotebookSheet({ open, onClose }: NotebookSheetProps) {
  const { tasks, checkpoints, lessonNotes } = useStudent();
  const [search, setSearch] = useState("");

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // Group notes by checkpoint
  const noteGroups = useMemo(() => {
    const groups: {
      checkpoint: { id: string; title: string; sort_order: number };
      entries: { taskId: string; title: string; week: number; content: string }[];
    }[] = [];

    const cpMap = new Map(checkpoints.map((cp) => [cp.id, cp]));

    // Group tasks by checkpoint
    const tasksByCheckpoint = new Map<string, typeof tasks>();
    for (const task of tasks) {
      if (!tasksByCheckpoint.has(task.checkpoint_id)) {
        tasksByCheckpoint.set(task.checkpoint_id, []);
      }
      tasksByCheckpoint.get(task.checkpoint_id)!.push(task);
    }

    for (const cp of checkpoints) {
      const cpTasks = tasksByCheckpoint.get(cp.id) ?? [];
      const entries: typeof groups[0]["entries"] = [];

      for (const task of cpTasks.sort((a, b) => a.sort_order - b.sort_order)) {
        const content = lessonNotes[task.id];
        if (!content?.trim()) continue;

        const matchesSearch =
          !search ||
          task.title.toLowerCase().includes(search.toLowerCase()) ||
          content.toLowerCase().includes(search.toLowerCase());

        if (matchesSearch) {
          entries.push({
            taskId: task.id,
            title: task.title,
            week: task.week,
            content,
          });
        }
      }

      if (entries.length > 0) {
        const checkpoint = cpMap.get(cp.id);
        groups.push({
          checkpoint: {
            id: cp.id,
            title: checkpoint?.title ?? cp.id,
            sort_order: checkpoint?.sort_order ?? 0,
          },
          entries,
        });
      }
    }

    return groups.sort((a, b) => a.checkpoint.sort_order - b.checkpoint.sort_order);
  }, [tasks, checkpoints, lessonNotes, search]);

  const totalNotes = Object.values(lessonNotes).filter((v) => v?.trim()).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[var(--color-bg-primary)]/70 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="
              fixed inset-4 sm:inset-8 md:left-1/2 md:-translate-x-1/2 md:w-[640px] md:max-w-full md:inset-y-8
              z-50 flex flex-col
              bg-[var(--color-bg-card)] border border-[var(--color-border-strong)]
              rounded-2xl shadow-[0_0_60px_rgba(0,0,0,0.5)]
              overflow-hidden
            "
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 sm:p-6 border-b border-[var(--color-border)]">
              <div>
                <h2 className="display-heading text-[22px] sm:text-[26px]">
                  Your Notebook
                </h2>
                <p className="mono-label mt-1">
                  {totalNotes} note{totalNotes === 1 ? "" : "s"} across your
                  journey
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                aria-label="Close notebook"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="px-5 sm:px-6 pt-4">
              <input
                type="text"
                placeholder="Search notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="
                  w-full px-4 py-2.5 rounded-xl
                  bg-[var(--color-bg-elevated)] border border-[var(--color-border)]
                  text-[14px] text-[var(--color-text-primary)]
                  placeholder:text-[var(--color-text-quaternary)]
                  outline-none focus:border-[var(--color-accent)]/40
                  transition-colors
                "
              />
            </div>

            {/* Notes list */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              {noteGroups.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-[var(--color-text-tertiary)] text-[14px]">
                    {totalNotes === 0
                      ? "No notes yet. Open a lesson and start writing!"
                      : "No notes match your search."}
                  </p>
                </div>
              ) : (
                noteGroups.map((group) => (
                  <div key={group.checkpoint.id}>
                    <h3 className="mono-label-accent mb-3">
                      {group.checkpoint.title}
                    </h3>
                    <div className="space-y-3">
                      {group.entries.map((entry) => (
                        <div
                          key={entry.taskId}
                          className="p-4 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)]"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="mono-label">
                              Week {entry.week}
                            </span>
                            <span className="text-[var(--color-text-quaternary)]">
                              &middot;
                            </span>
                            <span className="text-[13px] font-medium text-[var(--color-text-secondary)] truncate">
                              {entry.title}
                            </span>
                          </div>
                          <p className="text-[14px] text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">
                            {entry.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
