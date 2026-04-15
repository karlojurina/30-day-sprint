"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { Student, Task, StudentTaskCompletion, DailyNote, DiscountRequest } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { WEEK_TITLES, TASK_TYPE_LABELS } from "@/lib/constants";
import Link from "next/link";

export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.id as string;
  const supabase = createClient();

  const [student, setStudent] = useState<Student | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completions, setCompletions] = useState<StudentTaskCompletion[]>([]);
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStudent() {
      const [studentRes, tasksRes, completionsRes, notesRes, discountRes] =
        await Promise.all([
          supabase.from("students").select("*").eq("id", studentId).single(),
          supabase.from("tasks").select("*").order("week").order("sort_order"),
          supabase
            .from("student_task_completions")
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
      if (tasksRes.data) setTasks(tasksRes.data);
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

  const completedIds = new Set(completions.map((c) => c.task_id));
  const dayNumber = getDayNumber(student.joined_at);
  const overallPercent = Math.round((completedIds.size / 23) * 100);

  // Activation points
  const ap1 = tasks.some((t) => t.activation_point_id === "AP1" && completedIds.has(t.id));
  const ap2 = tasks.some((t) => t.activation_point_id === "AP2" && completedIds.has(t.id));
  const ap3 = tasks.some((t) => t.activation_point_id === "AP3" && completedIds.has(t.id));

  // Group tasks by week
  const tasksByWeek: Record<number, Task[]> = {};
  for (const task of tasks) {
    if (!tasksByWeek[task.week]) tasksByWeek[task.week] = [];
    tasksByWeek[task.week].push(task);
  }

  // Discount tasks
  const discountTasks = tasks.filter((t) => t.is_discount_required);
  const discountCompleted = discountTasks.filter((t) => completedIds.has(t.id)).length;

  // DM templates
  const dmTemplates = [
    {
      label: "Welcome",
      text: `Hey ${student.name || "there"}! Welcome to EcomTalent. I'm here to help you get the most out of your first 30 days. Have you checked out your playbook yet? Let me know if you have any questions!`,
    },
    {
      label: "Check-in",
      text: `Hey ${student.name || "there"}! Just checking in — how's everything going? I noticed you're on Day ${dayNumber}. Is there anything I can help you with?`,
    },
    {
      label: "Encouragement",
      text: `Hey ${student.name || "there"}! You're making great progress — ${overallPercent}% through your playbook. Keep going! The action items in the next section are where things really click.`,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Back link + header */}
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

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Progress</p>
          <p className="text-xl font-bold text-accent-light">{overallPercent}%</p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Discord</p>
          <p className="text-sm font-medium truncate">{student.discord_username || "—"}</p>
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

      {/* Activation Points */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Activation Points</h2>
        <div className="flex gap-4">
          {[
            { label: "AP1: Content", hit: ap1 },
            { label: "AP2: Ad Review", hit: ap2 },
            { label: "AP3: Ad Bounty", hit: ap3 },
          ].map((ap) => (
            <div key={ap.label} className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  ap.hit ? "bg-success" : "bg-bg-elevated"
                }`}
              />
              <span
                className={`text-xs ${
                  ap.hit ? "text-success" : "text-text-tertiary"
                }`}
              >
                {ap.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Task grid */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Task Progress</h2>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((week) => (
            <div key={week}>
              <p className="text-xs text-text-secondary mb-2">
                Week {week}: {WEEK_TITLES[week]}
              </p>
              <div className="space-y-1">
                {(tasksByWeek[week] || []).map((task) => {
                  const done = completedIds.has(task.id);
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                          done
                            ? "bg-accent border-accent"
                            : "border-border"
                        }`}
                      >
                        {done && (
                          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span
                        className={
                          done ? "text-text-secondary line-through" : "text-text-primary"
                        }
                      >
                        {task.title}
                      </span>
                      <span className="text-text-tertiary">
                        ({TASK_TYPE_LABELS[task.task_type]})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Discount Status */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-2">Discount Status</h2>
        <p className="text-xs text-text-secondary mb-2">
          {discountCompleted}/13 required tasks completed
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

      {/* DM Templates */}
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

      {/* Notes */}
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
