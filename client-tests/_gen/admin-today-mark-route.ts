/**
 * /api/admin/today/mark: Today's "Mark messaged" and "Not needed", and Undo
 * (admin rebuild PRD, call C5 and section 8, "Admin support list").
 *
 * POST { studentId, action: "messaged" | "not_needed", headlineKind,
 *        reasonsText, note?, openTaskIds: string[] }
 *   One call per row, with one moment (`at`) and the signed-in member as the
 *   actor for everything it writes:
 *   - for a headline the app computed, one support record: a `tasks` row with
 *     scenario support.<kind>, no template, completed (Messaged) or dismissed
 *     (Not needed, which needs a reason), behavior_summary = every reason on
 *     the row. Never open, so the queue's crons and its one-open-task index
 *     never meet it, and the Tasks page leaves template-less rows out;
 *   - every open queue task on the row, completed or dismissed with the same
 *     actor, note and moment, so Tasks and Today agree about the student.
 *   201 { supportId, movedIds, at }. A second mark of the same student and
 *   reason by the same member within 2 minutes answers 200 with the first.
 *   400 for an unknown reason, Not needed without a reason, or a task that is
 *   not an open task of this student. If closing the queue tasks fails, the
 *   record is taken back: the mark is all or nothing.
 *
 * DELETE { ids: string[] }
 *   Undo, each id on its own: 200 { results: [{ id, ok, status, error? }] }.
 *   A support record is deleted (only a support.* row with no template); a
 *   queue task a mark closed is opened again, unless the queue has a newer
 *   open task of its scenario for the student (409). Only the member who
 *   marked it (403), only within 15 minutes (409); an open task or an unknown
 *   id has nothing to undo (404).
 *
 * Auth: any team role (founder, admin, csm). Writes `tasks` only.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTeam, isAuthFailure } from "./admin-auth.ts";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";
import {
  REASON_LABEL,
  SUPPORT_SCENARIO,
  TASK_COLUMNS,
  UNDO_MINUTES,
  closedAt,
  closedBy,
  isReasonKind,
  isSupportRecord,
} from "./support-list.ts";
import type { SupportTask } from "./support-list.ts";

export const dynamic = "force-dynamic";

/** A second click inside this window is the same mark. */
const DUPLICATE_MS = 2 * 60_000;
const UNDO_MS = UNDO_MINUTES * 60_000;
const MAX_SUMMARY = 2000;
const MAX_NOTE = 500;
const MAX_UNDO = 50;

function refuse(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function failed(error: string, detail: string) {
  console.error(`[admin today mark] ${detail}`);
  return NextResponse.json({ error }, { status: 500 });
}

/** The moment is within `windowMs` of now, either side (two servers' clocks may differ a little). */
function near(iso: string | null | undefined, nowMs: number, windowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Math.abs(nowMs - t) <= windowMs;
}

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase, teamMember } = auth;
  const actor = teamMember.id;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return refuse("The mark could not be read. Reload the page and try again.");
  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId) return refuse("The mark names no student. Reload the page and try again.");
  const action = body.action;
  if (action !== "messaged" && action !== "not_needed") return refuse("A mark is either Messaged or Not needed.");
  const kind = body.headlineKind;
  if (!isReasonKind(kind)) return refuse("That reason is not one Today knows, so nothing was saved.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
  if (action === "not_needed" && !note) return refuse("Not needed needs a reason. Write one and try again.");
  const rawIds = body.openTaskIds ?? [];
  if (!Array.isArray(rawIds) || !rawIds.every((x) => typeof x === "string" && x.length > 0)) {
    return refuse("The mark's list of queue tasks could not be read. Reload the page and try again.");
  }
  const openTaskIds = [...new Set(rawIds as string[])];
  if (kind === "open_task" && openTaskIds.length === 0) {
    return refuse("This row's task in the Tasks queue is missing from the mark. Reload the page and try again.");
  }
  const reasonsText =
    typeof body.reasonsText === "string" && body.reasonsText.trim()
      ? body.reasonsText.trim().slice(0, MAX_SUMMARY)
      : REASON_LABEL[kind];

  const student = await supabase.from("students").select("id").eq("id", studentId).maybeSingle();
  if (student.error) return failed("Couldn't read the student, so nothing was saved. Try again.", student.error.message);
  if (!student.data) return refuse("This student is no longer in the database.", 404);

  const read = await fetchAllRowsPaginated<SupportTask>(() =>
    supabase.from("tasks").select(TASK_COLUMNS).eq("student_id", studentId).order("id"),
  );
  if (read.error) return failed("Couldn't read the student's tasks, so nothing was saved. Try again.", read.error.message);
  const mine = read.data;
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const scenario = kind === "open_task" ? null : SUPPORT_SCENARIO[kind];

  // A second click: the first mark's answer, and nothing written.
  if (scenario) {
    const first = mine
      .filter((t) => isSupportRecord(t) && t.scenario_id === scenario && closedBy(t) === actor && near(t.created_at, nowMs, DUPLICATE_MS))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    if (first) {
      const firstMs = Date.parse(first.created_at);
      const movedIds = mine
        .filter((t) => !isSupportRecord(t) && closedBy(t) === actor && Date.parse(closedAt(t) ?? "") === firstMs)
        .map((t) => t.id);
      return NextResponse.json({ supportId: first.id, movedIds, at: first.created_at }, { status: 200 });
    }
  } else {
    const wanted = action === "messaged" ? "completed" : "dismissed";
    const closed = openTaskIds.map((id) => mine.find((t) => t.id === id));
    if (closed.every((t) => t && t.status === wanted && closedBy(t) === actor && near(closedAt(t), nowMs, DUPLICATE_MS))) {
      const at = closed.map((t) => closedAt(t!)!).sort()[0];
      return NextResponse.json({ supportId: null, movedIds: openTaskIds, at }, { status: 200 });
    }
  }

  const notOpen = openTaskIds.filter((id) => {
    const t = mine.find((x) => x.id === id);
    return !t || t.status !== "open" || isSupportRecord(t);
  });
  if (notOpen.length) {
    return refuse("A task on this row is not an open task of this student in the Tasks queue, so nothing was saved. Reload the list.");
  }

  let supportId: string | null = null;
  if (scenario) {
    const inserted = await supabase
      .from("tasks")
      .insert({
        student_id: studentId,
        scenario_id: scenario,
        template_id: null,
        status: action === "messaged" ? "completed" : "dismissed",
        behavior_summary: reasonsText,
        created_at: nowIso,
        ...(action === "messaged"
          ? { completed_at: nowIso, completed_by: actor }
          : { dismissed_at: nowIso, dismissed_by: actor }),
        notes: note || null,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      return failed("Couldn't save the mark, so nothing was changed. Try again.", inserted.error?.message ?? "no row back");
    }
    supportId = (inserted.data as { id: string }).id;
  }

  let movedIds: string[] = [];
  if (openTaskIds.length) {
    const patch =
      action === "messaged"
        ? {
            status: "completed",
            completed_at: nowIso,
            completed_by: actor,
            dismissed_at: null,
            dismissed_by: null,
            ...(note ? { notes: note } : {}),
          }
        : { status: "dismissed", dismissed_at: nowIso, dismissed_by: actor, completed_at: null, completed_by: null, notes: note };
    const moved = await supabase
      .from("tasks")
      .update(patch)
      .in("id", openTaskIds)
      .eq("student_id", studentId)
      .eq("status", "open")
      .select("id");
    if (moved.error) {
      // All or nothing: take the record back.
      if (supportId) {
        const back = await supabase.from("tasks").delete().eq("id", supportId);
        if (back.error) {
          return failed(
            "The mark was saved, but its task in the Tasks queue could not be closed. Undo the mark from Handled and try again.",
            `${moved.error.message}; taking the record back: ${back.error.message}`,
          );
        }
      }
      return failed("Couldn't close the row's task in the Tasks queue, so nothing was saved. Try again.", moved.error.message);
    }
    movedIds = ((moved.data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (!supportId && movedIds.length === 0) {
      return refuse("Someone closed this task in the Tasks queue meanwhile, so there was nothing to mark. Reload the list.", 409);
    }
  }

  return NextResponse.json({ supportId, movedIds, at: nowIso }, { status: 201 });
}

interface UndoResult {
  id: string;
  ok: boolean;
  status: number;
  error?: string;
}

const GONE = "Not found. It may have been undone already.";
const NEWER_OPEN = "The Tasks queue has a newer open task of this kind for the student, so this one stays closed.";

async function undoOne(db: SupabaseClient, t: SupportTask | undefined, id: string, actor: string, nowMs: number): Promise<UndoResult> {
  if (!t) return { id, ok: false, status: 404, error: GONE };
  const at = closedAt(t);
  if (!at) return { id, ok: false, status: 404, error: "This task is still open, so there is nothing to undo." };
  if (closedBy(t) !== actor) return { id, ok: false, status: 403, error: "Only the team member who marked it can undo it." };
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs) || nowMs - atMs > UNDO_MS) {
    return { id, ok: false, status: 409, error: `It was marked more than ${UNDO_MINUTES} minutes ago, so it can't be undone here.` };
  }

  if (isSupportRecord(t)) {
    const del = await db
      .from("tasks")
      .delete()
      .eq("id", id)
      .like("scenario_id", "support.%")
      .is("template_id", null)
      .select("id");
    if (del.error) {
      console.error(`[admin today mark] undo ${id}: ${del.error.message}`);
      return { id, ok: false, status: 500, error: "Couldn't undo it. Try again." };
    }
    if (!del.data?.length) return { id, ok: false, status: 404, error: GONE };
    return { id, ok: true, status: 200 };
  }

  // A queue task the mark closed: open it again, unless the queue has opened a newer one since.
  const newer = await db
    .from("tasks")
    .select("id")
    .eq("student_id", t.student_id)
    .eq("scenario_id", t.scenario_id)
    .eq("status", "open")
    .limit(1);
  if (newer.error) {
    console.error(`[admin today mark] undo ${id}: ${newer.error.message}`);
    return { id, ok: false, status: 500, error: "Couldn't undo it. Try again." };
  }
  if (newer.data?.length) return { id, ok: false, status: 409, error: NEWER_OPEN };
  const reopened = await db
    .from("tasks")
    .update({ status: "open", completed_at: null, completed_by: null, dismissed_at: null, dismissed_by: null, notes: null })
    .eq("id", id)
    .eq("status", t.status)
    .select("id");
  if (reopened.error) {
    // 23505: the queue opened a newer task of this scenario a moment ago (idx_tasks_unique_open).
    if ((reopened.error as { code?: string }).code === "23505") return { id, ok: false, status: 409, error: NEWER_OPEN };
    console.error(`[admin today mark] undo ${id}: ${reopened.error.message}`);
    return { id, ok: false, status: 500, error: "Couldn't undo it. Try again." };
  }
  if (!reopened.data?.length) {
    return { id, ok: false, status: 409, error: "It changed meanwhile, so it was not undone. Reload the list." };
  }
  return { id, ok: true, status: 200 };
}

export async function DELETE(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase, teamMember } = auth;

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const raw = body && Array.isArray(body.ids) ? body.ids : null;
  if (!raw || raw.length === 0 || !raw.every((x) => typeof x === "string" && x.length > 0)) {
    return refuse("Undo needs the entries to undo. Reload the page and try again.");
  }
  const ids = [...new Set(raw as string[])];
  if (ids.length > MAX_UNDO) return refuse(`Undo takes at most ${MAX_UNDO} entries at once.`);

  const read = await supabase.from("tasks").select(TASK_COLUMNS).in("id", ids).order("id");
  if (read.error) return failed("Couldn't read what to undo, so nothing was changed. Try again.", read.error.message);
  const found = new Map(((read.data ?? []) as SupportTask[]).map((t) => [t.id, t] as const));

  const nowMs = Date.now();
  const results: UndoResult[] = [];
  for (const id of ids) results.push(await undoOne(supabase, found.get(id), id, teamMember.id, nowMs));
  return NextResponse.json({ results }, { status: 200 });
}
