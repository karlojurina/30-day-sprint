"use client";

import { createClient } from "@/lib/supabase-browser";
import { loadCourseActivity } from "@/lib/useJourneyPaceCounts";
import type { OutreachInsights } from "@/lib/outreach-insights";
import { send, type Answer } from "./admin-transport";
import { buildJourney, readJourney, type Journey } from "./journey-board";
import { buildStudentDetail, readStudentDetail, type StudentDetail } from "./student-detail";
import { buildStudentsList, readStudentsList, type StudentsList } from "./students-list";
import type { TaskStatus, TasksAnswer } from "./tasks-view";

/**
 * The calls of the Tasks page, its insights, All students, the student page
 * and the Student journey (admin rebuild 2, lane WI-5 and WI-6), behind
 * interfaces, as admin-transport.ts does for the 30% page: the dev pages
 * under /dev/admin hand the same views a stand-in
 * (src/app/dev/admin/fixtures-people.ts) and every state shows with no
 * login and no database.
 *
 * The Tasks page and its insights call their routes with the team member's
 * token (admin-transport.ts's send). The three student pages read the
 * database with the member's own session, as they did before, through the
 * readers in students-list.ts, student-detail.ts and journey-board.ts; those
 * keep each read's failure apart, so the page says what could not be read.
 *
 * No call throws: every answer is `{ ok: true, data }` or `{ ok: false,
 * error }` with a sentence the page can show.
 */

export interface TasksTransport {
  /** GET /api/admin/tasks?status=all&limit=500, with the search when there is one. */
  loadTasks(search: string): Promise<Answer<TasksAnswer>>;
  /** POST /api/admin/tasks/[id]/transition: sent, dismissed (with the team's reason) or back to To do. */
  transition(taskId: string, to: TaskStatus, notes?: string): Promise<Answer<null>>;
  /** POST /api/admin/tasks/[id]/outcome: replied, no reply, or neither. */
  setOutcome(taskId: string, outcome: "replied" | "no_reply" | null): Promise<Answer<null>>;
  /**
   * The task checks: founders and admins run refresh-everything (the Whop
   * sync, the snapshots and the three CSM crons, about 2 minutes), anyone
   * else run-task-crons (the two task crons). Answers how many tasks they made.
   */
  runChecks(full: boolean): Promise<Answer<{ created: number; text: string }>>;
}

export interface InsightsTransport {
  /** GET /api/admin/tasks/insights, from `sinceIso` or over every task since the reset. */
  loadInsights(sinceIso: string | null): Promise<Answer<OutreachInsights>>;
}

export interface PeopleTransport {
  loadStudents(): Promise<Answer<StudentsList>>;
  /** One student; null when there is no such student. */
  loadStudent(studentId: string): Promise<Answer<StudentDetail | null>>;
  loadJourney(): Promise<Answer<Journey>>;
  /** students.csm_exempt, written with the member's session as before. */
  setExempt(studentId: string, exempt: boolean): Promise<Answer<null>>;
  /** POST /api/admin/verify-ad-submissions. */
  setAdVerified(studentId: string, verified: boolean): Promise<Answer<null>>;
}

const asNull = <T,>(r: Answer<T>): Answer<null> => (r.ok ? { ...r, data: null } : r);
const fail = <T,>(error: string): Answer<T> => ({ ok: false, status: 0, error });

export const tasksTransport: TasksTransport = {
  loadTasks(search) {
    const params = new URLSearchParams({ status: "all", limit: "500" });
    if (search.trim()) params.set("student", search.trim());
    return send<TasksAnswer>("GET", `/api/admin/tasks?${params.toString()}`);
  },
  async transition(taskId, to, notes) {
    return asNull(await send("POST", `/api/admin/tasks/${encodeURIComponent(taskId)}/transition`, () => ({ to, notes })));
  },
  async setOutcome(taskId, outcome) {
    return asNull(await send("POST", `/api/admin/tasks/${encodeURIComponent(taskId)}/outcome`, () => ({ outcome })));
  },
  async runChecks(full) {
    if (full) {
      const r = await send<{
        sync?: { fetched?: number };
        csm_tasks?: { tasks_created?: number };
        na_tasks?: { created?: number };
        engagement?: { alerts?: number };
      }>("POST", "/api/admin/refresh-everything");
      if (!r.ok) return r;
      const created = (r.data?.csm_tasks?.tasks_created ?? 0) + (r.data?.na_tasks?.created ?? 0);
      return {
        ...r,
        data: {
          created,
          text: `Checked everything: Whop ${r.data?.sync?.fetched ?? 0} members, ${created} new ${created === 1 ? "task" : "tasks"}, ${r.data?.engagement?.alerts ?? 0} alerts.`,
        },
      };
    }
    // run-task-crons answers 200 with each cron's own answer, and { error } (or null) for one that failed.
    const r = await send<{
      csm: { tasks_created?: number; error?: string } | null;
      na: { created?: number; error?: string } | null;
    }>("POST", "/api/admin/run-task-crons");
    if (!r.ok) return r;
    const { csm, na } = r.data ?? { csm: null, na: null };
    if (!csm || csm.error || !na || na.error) {
      return fail("Some task checks could not run. Try again in a minute.");
    }
    const created = (csm.tasks_created ?? 0) + (na.created ?? 0);
    return { ...r, data: { created, text: `Checked the tasks: ${created} new ${created === 1 ? "task" : "tasks"}.` } };
  },
};

export const insightsTransport: InsightsTransport = {
  loadInsights(sinceIso) {
    return send<OutreachInsights>(
      "GET",
      `/api/admin/tasks/insights${sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : ""}`,
    );
  },
};

export const peopleTransport: PeopleTransport = {
  async loadStudents() {
    const supabase = createClient();
    const [reads, course] = await Promise.all([readStudentsList(supabase), loadCourseActivity(supabase)]);
    if (!reads.students.ok) return fail(`Couldn't load the students (${reads.students.error}).`);
    return { ok: true, status: 200, data: buildStudentsList({ ...reads, students: reads.students }, course, new Date().toISOString()) };
  },

  async loadStudent(studentId) {
    const supabase = createClient();
    const [reads, course] = await Promise.all([readStudentDetail(supabase, studentId), loadCourseActivity(supabase, studentId)]);
    if (!reads.student.ok) return fail(`Couldn't load this student (${reads.student.error}).`);
    if (!reads.student.data) return { ok: true, status: 200, data: null };
    return {
      ok: true,
      status: 200,
      data: buildStudentDetail({ ...reads, student: { ok: true, data: reads.student.data } }, course, new Date().toISOString()),
    };
  },

  async loadJourney() {
    const supabase = createClient();
    const [reads, course] = await Promise.all([readJourney(supabase), loadCourseActivity(supabase)]);
    if (!reads.students.ok) return fail(`Couldn't load the students on the journey (${reads.students.error}).`);
    return { ok: true, status: 200, data: buildJourney({ ...reads, students: reads.students }, course, new Date().toISOString()) };
  },

  async setExempt(studentId, exempt) {
    // A write row level security refuses changes no row and reports no
    // error: asking for the row back tells the two apart.
    const { data, error } = await createClient()
      .from("students")
      .update({ csm_exempt: exempt })
      .eq("id", studentId)
      .select("id");
    if (error) return fail(`Couldn't save it (${error.message}).`);
    if (!data || data.length === 0) return fail("Couldn't save it: the change was not allowed.");
    return { ok: true, status: 200, data: null };
  },

  async setAdVerified(studentId, verified) {
    return asNull(await send("POST", "/api/admin/verify-ad-submissions", () => ({ studentId, verified })));
  },
};
