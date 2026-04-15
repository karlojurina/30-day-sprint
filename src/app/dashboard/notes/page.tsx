"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import type { DailyNote } from "@/types/database";
import Link from "next/link";

export default function NotesPage() {
  const { student } = useAuth();
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!student) return;

    async function fetchNotes() {
      const { data } = await supabase
        .from("daily_notes")
        .select("*")
        .eq("student_id", student!.id)
        .order("note_date", { ascending: false });

      if (data) setNotes(data);
      setLoading(false);
    }

    fetchNotes();
  }, [student, supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-bg-primary/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-bold">My Notes</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {notes.length === 0 ? (
          <p className="text-center text-text-secondary py-12">
            No notes yet. Start writing on your dashboard!
          </p>
        ) : (
          <div className="space-y-4">
            {notes.map((note) => (
              <div
                key={note.id}
                className="bg-bg-card border border-border rounded-xl p-4"
              >
                <p className="text-xs text-text-tertiary mb-2">
                  {new Date(note.note_date).toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <p className="text-sm text-text-primary whitespace-pre-wrap">
                  {note.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
