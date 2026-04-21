"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type {
  Student,
  Region,
  Lesson,
  StudentLessonCompletion,
  DailyNote,
  DiscountRequest,
} from "@/types/database";
import { getDayNumber } from "@/types/database";
import { LESSON_TYPE_LABELS, TOTAL_LESSONS } from "@/lib/constants";
import Link from "next/link";

export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.id as string;
  const supabase = createClient();

  const [student, setStudent] = useState<Student | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [completions, setCompletions] = useState<StudentLessonCompletion[]>([]);
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStudent() {
      const [
        studentRes,
        regionsRes,
        lessonsRes,
        completionsRes,
        notesRes,
        discountRes,
      ] = await Promise.all([
        supabase.from("students").select("*").eq("id", studentId).single(),
        supabase.from("regions").select("*").order("order_num"),
        supabase.from("lessons").select("*").order("day").order("sort_order"),
        supabase
          .from("student_lesson_completions")
          .select("*")
          .eq("student_id", studentId),
        supabase
          .from("daily_notes")
          .select("*")
          .eq("student_id", studentId)
          .order("note_date", { ascending: false }),
        supabase
          .from("discount_requests")
          .select("*")
          .eq("student_id", studentId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
      ]);

      if (studentRes.data) setStudent(studentRes.data);
      if (regionsRes.data) setRegions(regionsRes.data);
      if (lessonsRes.data) setLessons(lessonsRes.data);
      if (completionsRes.data) setCompletions(completionsRes.data);
      if (notesRes.data) setNotes(notesRes.data);
      if (discountRes.data) setDiscountRequest(discountRes.data);
      setLoading(false);
    }

    fetchStudent();
  }, [studentId, supabase]);

  if (loading || !student) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const completedIds = new Set(completions.map((c) => c.lesson_id));
  const dayNumber = getDayNumber(student.joined_at);
  const overallPercent = Math.round((completedIds.size / TOTAL_LESSONS) * 100);

  // Group lessons by region
  const lessonsByRegion: Record<string, Lesson[]> = {};
  for (const lesson of lessons) {
    if (!lessonsByRegion[lesson.region_id]) lessonsByRegion[lesson.region_id] = [];
    lessonsByRegion[lesson.region_id].push(lesson);
  }

  // Discount status
  const gateCompleted = completedIds.has("l18");

  // DM templates
  const dmTemplates = [
    {
      label: "Welcome",
      text: `Hey ${student.name || "there"}! Welcome to EcomTalent. I'm here to help you get the most out of your first 30 days. Have you checked out your expedition map yet? Let me know if you have any questions!`,
    },
    {
      label: "Check-in",
      text: `Hey ${student.name || "there"}! Just checking in — how's everything going? I noticed you're on Day ${dayNumber}. Is there anything I can help you with?`,
    },
    {
      label: "Encouragement",
      text: `Hey ${student.name || "there"}! You're making great progress — ${overallPercent}% through your expedition. Keep going! The next region is where things really click.`,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/students"
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold">{student.name || "Student"}</h1>
          <p className="text-sm text-text-secondary">
            {student.email} — Day {dayNumber} — {student.membership_status}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Progress</p>
          <p className="text-xl font-bold text-accent-light">{overallPercent}%</p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Streak</p>
          <p className="text-xl font-bold">{student.current_streak ?? 0} days</p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Joined</p>
          <p className="text-sm font-medium">
            {new Date(student.joined_at).toLocaleDateString()}
          </p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Last Active</p>
          <p className="text-sm font-medium">
            {new Date(student.last_active_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Lesson grid by region */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Lesson Progress</h2>
        <div className="space-y-4">
          {regions.map((region) => (
            <div key={region.id}>
              <p className="text-xs text-text-secondary mb-2">
                {region.name} — {region.subtitle} ({region.days_label})
              </p>
              <div className="space-y-1">
                {(lessonsByRegion[region.id] || []).map((lesson) => {
                  const done = completedIds.has(lesson.id);
                  return (
                    <div
                      key={lesson.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                          done ? "bg-accent border-accent" : "border-border"
                        }`}
                      >
                        {done && (
                          <svg
                            className="w-2 h-2 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={4}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span
                        className={
                          done ? "text-text-secondary line-through" : "text-text-primary"
                        }
                      >
                        Day {lesson.day}: {lesson.title}
                      </span>
                      <span className="text-text-tertiary">
                        ({LESSON_TYPE_LABELS[lesson.type]})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-2">Discount Status</h2>
        <p className="text-xs text-text-secondary mb-2">
          Gate lesson (l18): {gateCompleted ? "completed" : "not yet"}
        </p>
        {discountRequest ? (
          <span
            className={`text-xs font-semibold uppercase px-2 py-1 rounded ${
              discountRequest.status === "approved"
                ? "bg-success/15 text-success"
                : discountRequest.status === "pending"
                  ? "bg-warning/15 text-warning"
                  : "bg-danger/15 text-danger"
            }`}
          >
            {discountRequest.status}
            {discountRequest.promo_code && ` — ${discountRequest.promo_code}`}
          </span>
        ) : (
          <span className="text-xs text-text-tertiary">No request submitted</span>
        )}
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Quick DM Templates</h2>
        <div className="flex gap-2 flex-wrap">
          {dmTemplates.map((tmpl) => (
            <button
              key={tmpl.label}
              onClick={() => navigator.clipboard.writeText(tmpl.text)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-bg-elevated hover:bg-accent/10 hover:text-accent-light transition-colors"
            >
              {tmpl.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary mt-2">
          Click to copy message to clipboard
        </p>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">
          Daily Notes ({notes.length})
        </h2>
        {notes.length === 0 ? (
          <p className="text-xs text-text-tertiary">No notes yet</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {notes.map((note) => (
              <div key={note.id} className="border-l-2 border-accent/30 pl-3">
                <p className="text-[10px] text-text-tertiary">
                  {new Date(note.note_date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <p className="text-xs text-text-secondary mt-0.5 whitespace-pre-wrap">
                  {note.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
