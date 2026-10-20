/**
 * The reads behind Today (GET /api/admin/today; admin rebuild PRD, section 9):
 * everything buildSupportRows (support-list.ts) needs, read at once.
 *
 *   students       the members C3 lists: active or past due, with a Whop
 *                  membership, not exempt, any plan
 *   progress       student_progress_counts, student_last_counted_completion,
 *                  student_current_region and the area names (regions)
 *   first login    student_milestones.first_sprint_login_at, where set
 *   Whop backfill  student_whop_sync.last_sync_at (never its tokens)
 *   heartbeats     student_lesson_watch.last_heartbeat_at of the last 3 days
 *   tasks          every open one; the completed and dismissed ones of the
 *                  last 30 days
 *   templates      every template (id, scenario, title, body, active)
 *   the rest       the team's names, the counting lessons' head count, the
 *                  course switch, admin_config's links, and the 30% through
 *                  loadThirtyData (thirty-data.ts)
 *
 * Every list is read in pages of 1000, ordered on a unique key, and lists of
 * ids go in batches of 100: PostgREST answers at most about 1000 rows, and
 * pages read without a stable order can repeat some rows and skip others.
 * The long reads keyed by one unique column (the members, the three progress
 * views, the first logins, the Whop dates and the tasks) page BY KEY
 * (fetchAllRowsByKey): pages read by offset are separate queries, and a row
 * that leaves the read meanwhile (a task closed or reopened, a student's only
 * counted lesson undone) would shift the later pages and drop another row.
 * A task closed or reopened between the open and the closed reads is on two
 * of them; it is kept once, closed (see tasks below).
 *
 * A read that fails is never an empty list. The course switch failing is its
 * own answer (the route says so); any other failed read fails the whole load,
 * with the reads named, so the page shows an error instead of a list with
 * people missing. So does a member who can still earn the 30% whose 30% could
 * not be read: Today answers an error rather than a list without its 30%
 * reasons.
 *
 * Server only: hand it the service-role client requireTeam gives a route.
 * lesson_videos, which the 30% needs, is readable by the service role alone.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurriculumResetAt } from "@/lib/curriculum-reset";
import { fetchAllRowsByKey, fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { loadAdminConfig } from "@/lib/templates";
import { factsFromReads } from "@/lib/world/discount-server";
import type { Read } from "@/lib/world/discount-server";
import { loadThirtyData } from "./thirty-data";
import { canStillEarnCandidate } from "./thirty-view";
import { HANDLED_DAYS, HEARTBEAT_HOLD_DAYS, TASK_COLUMNS, closedAt } from "./support-list";
import type { SupportInput, SupportStudent, SupportTask, SupportTemplate } from "./support-list";

const DAY_MS = 86_400_000;
const BATCH = 100;
/** The completed and dismissed tasks read: the cooldowns need 7 days, the last contact as many as can be had. */
export const CLOSED_TASK_DAYS = 30;

export const TODAY_STUDENT_COLUMNS =
  "id, name, email, discord_user_id, discord_username, whop_plan_id, whop_membership_id, membership_status, cancel_scheduled_at, first_paid_at, joined_at, csm_exempt, high_churn_risk";

/** Everything buildSupportRows reads, but who is reading. */
export type TodayData = Omit<SupportInput, "callerId">;

export type TodayLoad =
  | { ok: true; data: TodayData }
  /** "reset": the course switch could not be read. "reads": the reads named in `failed` could not. */
  | { ok: false; reason: "reset" | "reads"; failed: string[] };

async function paged<T>(build: () => unknown): Promise<Read<T[]>> {
  const r = await fetchAllRowsPaginated<T>(build);
  return r.error ? { data: null, error: { message: r.error.message } } : { data: r.data, error: null };
}

/** One read in pages by `key` (unique, and the read's only order): every row, or the error and no rows. */
async function pagedByKey<T>(build: () => unknown, key: string): Promise<Read<T[]>> {
  const r = await fetchAllRowsByKey<T>(build, key);
  return r.error ? { data: null, error: { message: r.error.message } } : { data: r.data, error: null };
}

function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

const failure = (name: string, r: { error: { message: string } | null }) => `${name}: ${r.error?.message ?? "no data"}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadTodayData(db: SupabaseClient, now: Date): Promise<TodayLoad> {
  const nowMs = now.getTime();
  const heartbeatsFrom = new Date(nowMs - HEARTBEAT_HOLD_DAYS * DAY_MS).toISOString();
  const closedFrom = new Date(nowMs - CLOSED_TASK_DAYS * DAY_MS).toISOString();

  const [
    reset,
    students,
    progress,
    lastLesson,
    currentArea,
    regions,
    firstLogin,
    sync,
    heartbeats,
    open,
    completed,
    dismissed,
    templates,
    team,
    lessons,
    config,
    thirty,
  ] = await Promise.all([
    getCurriculumResetAt(db).then(
      (value) => ({ ok: true as const, value }),
      (e: unknown) => ({ ok: false as const, error: message(e) }),
    ),
    pagedByKey<SupportStudent>(
      () =>
        db
          .from("students")
          .select(TODAY_STUDENT_COLUMNS)
          .in("membership_status", ["active", "past_due"])
          .not("whop_membership_id", "is", null)
          .eq("csm_exempt", false)
          .order("id"),
      "id",
    ),
    // The three views hold one row per student (v92, v98, v103).
    pagedByKey<{ student_id: string; completed_count: number }>(
      () => db.from("student_progress_counts").select("student_id, completed_count").order("student_id"),
      "student_id",
    ),
    pagedByKey<{ student_id: string; last_completed_at: string | null }>(
      () => db.from("student_last_counted_completion").select("student_id, last_completed_at").order("student_id"),
      "student_id",
    ),
    pagedByKey<{ student_id: string; current_region: string | null }>(
      () => db.from("student_current_region").select("student_id, current_region").order("student_id"),
      "student_id",
    ),
    paged<{ id: string; name: string | null; order_num: number }>(() =>
      db.from("regions").select("id, name, order_num").order("order_num").order("id"),
    ),
    pagedByKey<{ student_id: string; first_sprint_login_at: string }>(
      () =>
        db
          .from("student_milestones")
          .select("student_id, first_sprint_login_at")
          .not("first_sprint_login_at", "is", null)
          .order("student_id"),
      "student_id",
    ),
    // The backfill's date only: the row also holds the student's Whop tokens.
    pagedByKey<{ student_id: string; last_sync_at: string | null }>(
      () => db.from("student_whop_sync").select("student_id, last_sync_at").order("student_id"),
      "student_id",
    ),
    paged<{ student_id: string; lesson_id: string; last_heartbeat_at: string | null }>(() =>
      db
        .from("student_lesson_watch")
        .select("student_id, lesson_id, last_heartbeat_at")
        .gte("last_heartbeat_at", heartbeatsFrom)
        .order("student_id")
        .order("lesson_id"),
    ),
    pagedByKey<SupportTask>(() => db.from("tasks").select(TASK_COLUMNS).eq("status", "open").order("id"), "id"),
    pagedByKey<SupportTask>(
      () => db.from("tasks").select(TASK_COLUMNS).eq("status", "completed").gte("completed_at", closedFrom).order("id"),
      "id",
    ),
    pagedByKey<SupportTask>(
      () => db.from("tasks").select(TASK_COLUMNS).eq("status", "dismissed").gte("dismissed_at", closedFrom).order("id"),
      "id",
    ),
    paged<SupportTemplate>(() => db.from("templates").select("id, scenario_id, title, body, is_active").order("id")),
    paged<{ id: string; full_name: string | null }>(() => db.from("team_members").select("id, full_name").order("id")),
    // The same lessons student_progress_counts counts (v92), so "12 of 140" holds.
    Promise.resolve(
      db.from("lessons").select("id", { count: "exact", head: true }).eq("counts_toward_progress", true),
    ).then(
      (r) => r as { count: number | null; error: { message: string } | null },
      (e: unknown) => ({ count: null, error: { message: message(e) } }),
    ),
    loadAdminConfig(db).catch(() => ({})),
    loadThirtyData(db),
  ]);

  if (!reset.ok) return { ok: false, reason: "reset", failed: [`admin_config: ${reset.error}`] };

  const failed: string[] = [];
  for (const [name, r] of [
    ["students (Today's members)", students],
    ["student_progress_counts", progress],
    ["student_last_counted_completion", lastLesson],
    ["student_current_region", currentArea],
    ["regions", regions],
    ["student_milestones", firstLogin],
    ["student_whop_sync", sync],
    ["student_lesson_watch", heartbeats],
    ["tasks (open)", open],
    ["tasks (completed)", completed],
    ["tasks (dismissed)", dismissed],
    ["templates", templates],
    ["team_members", team],
  ] as const) {
    if (!r.data) failed.push(failure(name, r));
  }
  if (lessons.error || typeof lessons.count !== "number") failed.push(failure("lessons (counting)", lessons));
  if (!thirty.ok) failed.push(...thirty.failed.map((f) => `30%: ${f}`));
  if (failed.length || !thirty.ok) return { ok: false, reason: "reads", failed };

  // A member who can still earn the 30% and whose 30% could not be read: no list without it.
  const unreadable = students.data!.filter((s) => {
    const reads = thirty.data.reads.get(s.id);
    return reads !== undefined && canStillEarnCandidate(s) && !factsFromReads(reads).ok;
  });
  if (unreadable.length) {
    const first = factsFromReads(thirty.data.reads.get(unreadable[0].id)!);
    const why = first.ok ? "" : ` (${first.failed[0]})`;
    return {
      ok: false,
      reason: "reads",
      failed: [`30%: the progress of ${unreadable.length} member(s) who can still earn it could not be read${why}`],
    };
  }

  // One row per task. A task closed (or reopened) between the open read and
  // the closed ones is on two of them; its closed row is kept. Shown as open
  // when it is closed already, the row would invite a second message.
  const byTask = new Map<string, SupportTask>();
  for (const t of open.data!) byTask.set(t.id, t);
  for (const t of [...completed.data!, ...dismissed.data!]) byTask.set(t.id, t);
  const tasks = [...byTask.values()];

  // The names Handled shows for students who are not on the list (canceled since, say).
  const listed = new Set(students.data!.map((s) => s.id));
  const handledFrom = nowMs - HANDLED_DAYS * DAY_MS;
  const others = [
    ...new Set(
      tasks
        .filter((t) => {
          const at = closedAt(t);
          return at !== null && Date.parse(at) > handledFrom && !listed.has(t.student_id);
        })
        .map((t) => t.student_id),
    ),
  ].sort();
  const names = new Map<string, string | null>();
  if (others.length) {
    const read = await Promise.all(
      batches(others).map((batch) =>
        paged<{ id: string; name: string | null }>(() =>
          db.from("students").select("id, name").in("id", batch).order("id"),
        ),
      ),
    );
    const bad = read.find((r) => !r.data);
    if (bad) return { ok: false, reason: "reads", failed: [failure("students (named in Handled)", bad)] };
    for (const r of read) for (const s of r.data!) names.set(s.id, s.name ?? null);
  }

  const newestHeartbeat = new Map<string, string>();
  for (const h of heartbeats.data!) {
    if (!h.last_heartbeat_at) continue;
    const seen = newestHeartbeat.get(h.student_id);
    if (!seen || Date.parse(h.last_heartbeat_at) > Date.parse(seen)) newestHeartbeat.set(h.student_id, h.last_heartbeat_at);
  }
  const lastLessonBy = new Map<string, string>();
  for (const r of lastLesson.data!) if (r.last_completed_at) lastLessonBy.set(r.student_id, r.last_completed_at);
  const areaBy = new Map<string, string>();
  for (const r of currentArea.data!) if (r.current_region) areaBy.set(r.student_id, r.current_region);

  return {
    ok: true,
    data: {
      resetAt: reset.value,
      lessonsTotal: lessons.count!,
      students: students.data!,
      progress: new Map(progress.data!.map((r) => [r.student_id, Number(r.completed_count) || 0] as const)),
      lastLesson: lastLessonBy,
      currentArea: areaBy,
      areas: new Map(regions.data!.map((r) => [r.id, r.name ?? r.id] as const)),
      firstLogin: new Set(firstLogin.data!.map((r) => r.student_id)),
      lastSyncAt: new Map(sync.data!.map((r) => [r.student_id, r.last_sync_at ?? null] as const)),
      lastHeartbeat: newestHeartbeat,
      tasks,
      templates: templates.data!,
      team: new Map(team.data!.map((m) => [m.id, m.full_name ?? ""] as const)),
      names,
      config,
      thirty: thirty.data,
    },
  };
}
