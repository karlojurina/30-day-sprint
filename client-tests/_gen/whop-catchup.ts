/**
 * The Whop catch-up (T-089): one pull of every active member's finished Whop
 * lessons into the app, run from POST /api/admin/whop-catchup.
 *
 * Why it exists: a lesson finished on Whop reaches the app through the webhook
 * or through the backfill a login or a visit runs (watch-sync.ts). A member
 * who watches on Whop and has not opened the app since the course switch
 * holds none of it, and the day-3 lists would name them as not started.
 *
 * WHO, IN WHAT ORDER. Members with membership_status active or past_due, read
 * once per call. The CSM pool first (the filter check-csm-tasks reads:
 * active, not csm_exempt, on the paying plan, first paid within 30 days and
 * from 28 May), then everyone else, each group by id. The cursor
 * "<0 or 1>:<student id>" names the last member a call finished; the next
 * call starts after it, so a member who appears with an id behind it is left
 * to the webhook and their login.
 *
 * ONE MEMBER. The read the backfill makes (fetchCompletedLessonsAsAdmin: the
 * app's own key, the member's Whop id as the filter), at most 4 requests a
 * second counted start to start, matched on lessons.whop_lesson_id. A lesson
 * with no row gets one; a row with no completed_at (a skip, an action item
 * handed in first) is finished. Each carries Whop's created_at, the moment
 * the member opened the lesson there (Whop keeps no finish time); a time
 * later than the run's clock, a missing one or one that does not read as a
 * time becomes the run's clock, and is counted. A row that has a time keeps
 * it. A row added with Whop's own time is marked as such (completed_at_real,
 * v112: Triple Threat counts it on that day). Write mode then writes the
 * member's sync row with the same columns and values as the backfill (never
 * the token columns) and ticks the streak only
 * when a row it added was opened on Whop on the run's own UTC day (Lovro's
 * call A, 2026-10-19) and the member's streak does not count that day yet: a
 * tick on a counted day changes nothing, so it is neither counted nor listed
 * in changes.streak_ticked, the streak rows the undo puts back from the
 * snapshot. It moves no "last active", awards no badge, runs no "came back"
 * check and no CSM task check, and posts nothing to Discord: the next login
 * or visit evaluates the badges against the true days, and the crons read the
 * rows.
 *
 * FAILURES are counted by kind, never by message: the read's message carries
 * the member's Whop id and the course id. A failed member gets no write at
 * all, the sync row included, and the next pass tries them again. The call
 * stops at the first sign that Whop ignored the member filter, after 5
 * failures of one kind in a row, and when 25 members with finished Whop
 * lessons matched no lesson at all (WHOP_COURSE_ID names another course). A
 * 429 is waited out (the seconds Whop names, or 15, at most 30) and retried
 * twice; a third ends the call with the cursor before that member, and so
 * does a wait that would end past the 240 s budget. A Whop read still
 * unanswered 285 s into the call is given up the same way, so the call
 * answers before maxDuration (300 s) with its change log and its cursor.
 *
 * The design and the reasons: _admin/prds/night-2026-10-19/whop_catchup.md,
 * section 7, in the workspace (outside this repository).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCompletedLessonsAsAdmin } from "./whop.ts";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";
import {
  PAYING_WHOP_PLAN_IDS,
  TASKS_STUDENT_JOIN_CUTOFF,
  csmSprintWindowCutoffIso,
  whopNoneFinishedNote,
} from "./constants.ts";
import { tickStudentStreak } from "./stub-server.ts";
import { getTodayUtc } from "./streak.ts";

/** No new member is started after this, so a call answers before maxDuration (300 s). */
export const CATCHUP_DEADLINE_MS = 240_000;
/**
 * No Whop read is waited on past this point of a call. A member started just
 * inside the budget can still meet a read that stalls; at this point the call
 * gives it up and answers, 15 s before Vercel stops the function.
 */
export const CATCHUP_READ_LIMIT_MS = 285_000;
/** 4 Whop requests a second, start to start: about 6 of Whop's 10 stay free for the logins and visits sharing the key. */
const WHOP_GAP_MS = 250;
/** Whop's page size for course_lesson_interactions (whop.ts asks for first=100). */
const WHOP_PAGE_SIZE = 100;
/** The pages whop.ts reads before it refuses ("more than 5 pages"). */
const WHOP_MAX_PAGES = 5;
const RETRIES_AFTER_429 = 2;
const WAIT_429_DEFAULT_S = 15;
const WAIT_429_MAX_S = 30;
const SAME_KIND_IN_A_ROW_STOP = 5;
const MATCHED_NONE_STOP = 25;
/** Member ids per `.in()` filter, so the request's address stays short. */
const IDS_PER_READ = 100;
const DAY_MS = 86_400_000;

export type CatchupMode = "dry" | "write";

export type WhopFailKind =
  | "rate_limited"
  | "filter_ignored"
  | "too_many_pages"
  | "http_401_403"
  | "http_other"
  | "network";
export type DatabaseFailKind = "lessons_read_failed" | "write_failed";
export type CatchupFailKind = WhopFailKind | DatabaseFailKind;

export type CatchupStop =
  | "done"
  | "time budget"
  | "rate limited"
  | "filter ignored"
  | "failures in a row"
  | "no lesson matched";

export interface CatchupMember {
  id: string;
  whop_user_id: string;
  membership_status: string;
  csm_exempt: boolean | null;
  whop_plan_id: string | null;
  first_paid_at: string | null;
}

export interface CatchupCursor {
  group: 0 | 1;
  id: string;
}

interface OrderedMember {
  member: CatchupMember;
  /** 0 for the CSM pool, 1 for everyone else. */
  group: 0 | 1;
}

interface CompletionRow {
  id: string;
  lesson_id: string;
  completed_at: string | null;
  skipped_at: string | null;
}

/** The time a row the run adds carries. */
interface RowTime {
  /** What `completed_at` gets. */
  iso: string;
  /** The UTC day Whop's own time falls on; null when Whop gave none that reads as a time. */
  whopDay: string | null;
  source: "whop" | "later_than_run" | "missing";
}

/** The body's `after`: absent or null starts at the beginning; anything but "<0 or 1>:<id>" is refused. */
export function parseCatchupCursor(value: unknown): CatchupCursor | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const m = /^([01]):([^\s:]+)$/.exec(value);
  if (!m) return "invalid";
  return { group: m[1] === "0" ? 0 : 1, id: m[2] };
}

const MEMBER_COLUMNS = "id, whop_user_id, membership_status, csm_exempt, whop_plan_id, first_paid_at";

/** Every member with membership_status active or past_due, past PostgREST's 1,000-row cap. Throws on a failed read. */
export async function readCatchupMembers(supabase: SupabaseClient): Promise<CatchupMember[]> {
  const { data, error } = await fetchAllRowsPaginated<CatchupMember>(() =>
    supabase
      .from("students")
      .select(MEMBER_COLUMNS)
      .in("membership_status", ["active", "past_due"])
      .order("id", { ascending: true }),
  );
  if (error) throw new Error(`students read failed: ${error.message}`);
  return data;
}

/**
 * The pool the CSM cron builds its day-3 lists from (check-csm-tasks,
 * "Bulk pulls"): active, not exempt, on a paying plan, first paid on or after
 * the later of 28 May and 30 days ago. Times are compared as times, as the
 * database compares them.
 */
function inCsmPool(m: CatchupMember, paidFloorMs: number): boolean {
  const paid = m.first_paid_at ? Date.parse(m.first_paid_at) : NaN;
  return (
    m.membership_status === "active" &&
    m.csm_exempt === false &&
    m.whop_plan_id != null &&
    PAYING_WHOP_PLAN_IDS.has(m.whop_plan_id) &&
    Number.isFinite(paid) &&
    paid >= paidFloorMs
  );
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function orderMembers(members: CatchupMember[]): OrderedMember[] {
  const paidFloorMs = Math.max(
    Date.parse(TASKS_STUDENT_JOIN_CUTOFF),
    Date.parse(csmSprintWindowCutoffIso()),
  );
  return members
    .map((member): OrderedMember => ({ member, group: inCsmPool(member, paidFloorMs) ? 0 : 1 }))
    .sort((a, b) => a.group - b.group || compareIds(a.member.id, b.member.id));
}

function isAfter(o: OrderedMember, cursor: CatchupCursor | null): boolean {
  if (!cursor) return true;
  return o.group > cursor.group || (o.group === cursor.group && o.member.id > cursor.id);
}

const formatCursor = (c: CatchupCursor | null) => (c ? `${c.group}:${c.id}` : null);

/** Whop's created_at, or the run's clock when it is later than that clock or reads as no time. */
function rowTime(createdAt: unknown, nowMs: number): RowTime {
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  const runClock = new Date(nowMs).toISOString();
  if (!Number.isFinite(t)) return { iso: runClock, whopDay: null, source: "missing" };
  const whopDay = new Date(t).toISOString().slice(0, 10);
  if (t > nowMs) return { iso: runClock, whopDay, source: "later_than_run" };
  return { iso: new Date(t).toISOString(), whopDay, source: "whop" };
}

const TIME_RANK: Record<RowTime["source"], number> = { whop: 0, later_than_run: 1, missing: 2 };

/** Two interactions for one lesson: Whop's own time over a replaced one, then the earlier. */
function betterTime(a: RowTime, b: RowTime): boolean {
  return TIME_RANK[a.source] < TIME_RANK[b.source] || (TIME_RANK[a.source] === TIME_RANK[b.source] && a.iso < b.iso);
}

/**
 * The kind of a failed Whop read, from the message the read throws
 * (whop.ts, fetchCompletedLessonsAsAdmin). The message itself goes nowhere.
 */
function whopFailure(err: unknown): { kind: WhopFailKind; retryAfterS: number | null } {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("Whop user_id filter ignored")) return { kind: "filter_ignored", retryAfterS: null };
  if (message.includes("more than 5 pages of lesson interactions")) return { kind: "too_many_pages", retryAfterS: null };
  const status = /fetch failed \((\d{3})\)/.exec(message);
  if (status) {
    const code = Number(status[1]);
    if (code === 429) {
      const named = /try again in (\d+(?:\.\d+)?)\s*s/i.exec(message);
      return { kind: "rate_limited", retryAfterS: named ? Number(named[1]) : null };
    }
    if (code === 401 || code === 403) return { kind: "http_401_403", retryAfterS: null };
    return { kind: "http_other", retryAfterS: null };
  }
  // A 200 whose body is not JSON: an answer from Whop's side, not the network.
  if (err instanceof SyntaxError) return { kind: "http_other", retryAfterS: null };
  return { kind: "network", retryAfterS: null };
}

function waitAfter429Ms(named: number | null): number {
  const seconds = named == null || !Number.isFinite(named)
    ? WAIT_429_DEFAULT_S
    : Math.min(WAIT_429_MAX_S, Math.max(1, named));
  return seconds * 1000;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const READ_TIMED_OUT = Symbol("no Whop answer by the read limit");
type WhopRead = Awaited<ReturnType<typeof fetchCompletedLessonsAsAdmin>>;

/**
 * The member's Whop read, or READ_TIMED_OUT when Whop has not answered by
 * CATCHUP_READ_LIMIT_MS into the call. A read that fails rejects as it does
 * on its own. whop.ts takes no abort signal, so a read given up on runs on
 * unwatched and its answer is dropped (Promise.race keeps its rejection
 * handled). The timer is cleared either way, so none outlives the call.
 */
async function readBeforeLimit(whopUserId: string, startedAtMs: number): Promise<WhopRead | typeof READ_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof READ_TIMED_OUT>((resolve) => {
    timer = setTimeout(
      () => resolve(READ_TIMED_OUT),
      Math.max(0, startedAtMs + CATCHUP_READ_LIMIT_MS - Date.now()),
    );
  });
  try {
    return await Promise.race([fetchCompletedLessonsAsAdmin(whopUserId), limit]);
  } finally {
    clearTimeout(timer);
  }
}

function inChunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Rows of `table` for these students, every page of every chunk. Throws on a failed read. */
async function readForStudents<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orderBy: string,
  studentIds: string[],
): Promise<T[]> {
  const all: T[] = [];
  for (const chunk of inChunks(studentIds, IDS_PER_READ)) {
    const { data, error } = await fetchAllRowsPaginated<T>(() =>
      supabase.from(table).select(columns).in("student_id", chunk).order(orderBy, { ascending: true }),
    );
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    all.push(...data);
  }
  return all;
}

/**
 * One call of a dry or write pass, from just after `after` until the members
 * run out, the time budget is spent or a guard stops it. The answer is counts
 * only (and, in write mode, the change log of row ids, student ids, lesson ids
 * and times): nothing in it names a member, an email, a Whop id or the course.
 */
export async function runWhopCatchup(
  supabase: SupabaseClient,
  members: CatchupMember[],
  { mode, after, startedAtMs }: { mode: CatchupMode; after: CatchupCursor | null; startedAtMs: number },
): Promise<Record<string, unknown>> {
  const write = mode === "write";
  const runStartedAt = new Date(startedAtMs).toISOString();
  const ordered = orderMembers(members);
  const todo = ordered.filter((o) => isAfter(o, after));
  /** A read the whole call needs failed: nothing ran. */
  const setupFailure = (kind: string, error: string): Record<string, unknown> => ({
    ok: false,
    mode,
    run_started_at: runStartedAt,
    kind,
    error,
  });

  // The course, read once per call: Whop lesson id -> lesson id.
  const { data: lessonRows, error: lessonsError } = await supabase.from("lessons").select("id, whop_lesson_id");
  if (lessonsError) {
    console.error(`[whop-catchup] lessons read failed: ${lessonsError.message}`);
    return setupFailure("lessons_read_failed", "The course's lessons could not be read, so nothing ran. Try again.");
  }
  const lessonByWhopId = new Map<string, string>();
  for (const l of (lessonRows ?? []) as Array<{ id: string; whop_lesson_id: string | null }>) {
    if (l.whop_lesson_id) lessonByWhopId.set(l.whop_lesson_id, l.id);
  }

  // Who of the pool has logged in, for "logged in, still 0 lessons" (the
  // nolessons.day3 task asks the same: student_milestones.first_sprint_login_at).
  const loggedIn = new Set<string>();
  try {
    const poolIds = todo.filter((o) => o.group === 0).map((o) => o.member.id);
    const milestones = await readForStudents<{ student_id: string; first_sprint_login_at: string | null }>(
      supabase, "student_milestones", "student_id, first_sprint_login_at", "student_id", poolIds,
    );
    for (const r of milestones) if (r.first_sprint_login_at) loggedIn.add(r.student_id);
  } catch (e) {
    console.error(`[whop-catchup] ${e instanceof Error ? e.message : String(e)}`);
    return setupFailure("milestones_read_failed", "The members' first logins could not be read, so nothing ran. Try again.");
  }

  const whop = {
    requests: 0,
    retried_429: 0,
    failed: { rate_limited: 0, filter_ignored: 0, too_many_pages: 0, http_401_403: 0, http_other: 0, network: 0 } as Record<WhopFailKind, number>,
  };
  const database = { failed: { lessons_read_failed: 0, write_failed: 0 } as Record<DatabaseFailKind, number> };
  const students = { finished_on_whop: 0, opened_none_finished: 0, nothing_on_whop: 0, already_all_in_app: 0, got_rows: 0, failed: 0 };
  const rows = { inserted: 0, promoted: 0, not_in_course: 0, time_missing: 0, time_later_than_run: 0 };
  let earliestDay: string | null = null;
  let latestDay: string | null = null;
  const pool = { zero_lessons_now: 0, of_them_filled: 0, logged_in_still_zero: 0, last_lesson_3_to_6_days: 0, last_lesson_7_plus_days: 0 };
  let streakCount = 0;
  const changes = {
    /** [row id, student id, lesson id, completed_at] */
    inserted: [] as Array<[string, string, string, string]>,
    /** [row id, the skipped_at it had, completed_at] */
    promoted: [] as Array<[string, string | null, string]>,
    streak_ticked: [] as string[],
  };

  let cursor: CatchupCursor | null = after;
  let checked = 0;
  let stopped: CatchupStop = "done";
  let stopKind: string | null = null;
  let matchedNoneMembers = 0;
  let inARow: { kind: CatchupFailKind | null; count: number } = { kind: null, count: 0 };
  let nextWhopAt = 0;

  for (const o of todo) {
    if (Date.now() - startedAtMs > CATCHUP_DEADLINE_MS) {
      stopped = "time budget";
      break;
    }
    const m = o.member;

    /** A failure the member is passed over for (the next pass tries again). True when it is the 5th of its kind in a row. */
    const failMember = (kind: CatchupFailKind): boolean => {
      if (kind in whop.failed) whop.failed[kind as WhopFailKind] += 1;
      else database.failed[kind as DatabaseFailKind] += 1;
      students.failed += 1;
      console.error(`[whop-catchup] student=${m.id} failed: ${kind}`);
      checked += 1;
      cursor = { group: o.group, id: m.id };
      inARow = inARow.kind === kind ? { kind, count: inARow.count + 1 } : { kind, count: 1 };
      return inARow.count >= SAME_KIND_IN_A_ROW_STOP;
    };

    // 1. Whop, paced, a 429 waited out and retried, no read waited on past the limit.
    let read: WhopRead | null = null;
    let failKind: WhopFailKind | null = null;
    let endBefore: CatchupStop | null = null;
    for (let attempt = 0; ; attempt++) {
      const wait = nextWhopAt - Date.now();
      if (wait > 0) await sleep(wait);
      const start = Date.now();
      try {
        const got = await readBeforeLimit(m.whop_user_id, startedAtMs);
        if (got === READ_TIMED_OUT) {
          // Not finished and no failure: the cursor stays before this member,
          // nothing of theirs is written, and the next call starts with them.
          whop.requests += 1;
          console.warn(`[whop-catchup] student=${m.id} no Whop answer ${CATCHUP_READ_LIMIT_MS / 1000} s into the call, the call ends before them`);
          endBefore = "time budget";
          break;
        }
        read = got;
        // A member past 100 interactions took a second page: the next start waits for both.
        const pages = Math.max(1, Math.ceil(read.rawCount / WHOP_PAGE_SIZE));
        whop.requests += pages;
        nextWhopAt = start + WHOP_GAP_MS * pages;
        break;
      } catch (err) {
        const f = whopFailure(err);
        // A refusal after 5 pages made 5 requests; any other failure is
        // counted as one (one on a second page is not seen from here).
        const pages = f.kind === "too_many_pages" ? WHOP_MAX_PAGES : 1;
        whop.requests += pages;
        nextWhopAt = start + WHOP_GAP_MS * pages;
        if (f.kind !== "rate_limited") {
          failKind = f.kind;
          break;
        }
        if (attempt >= RETRIES_AFTER_429) {
          whop.failed.rate_limited += 1;
          endBefore = "rate limited";
          break;
        }
        const waitMs = waitAfter429Ms(f.retryAfterS);
        if (Date.now() + waitMs - startedAtMs > CATCHUP_DEADLINE_MS) {
          endBefore = "time budget";
          break;
        }
        whop.retried_429 += 1;
        await sleep(waitMs);
      }
    }
    if (endBefore) {
      stopped = endBefore;
      break;
    }
    if (failKind === "filter_ignored") {
      // Not finished: the cursor stays before this member, and nothing of theirs is written.
      whop.failed.filter_ignored += 1;
      console.error(`[whop-catchup] student=${m.id} failed: filter_ignored`);
      stopped = "filter ignored";
      stopKind = "filter_ignored";
      break;
    }
    if (failKind || !read) {
      if (failMember(failKind ?? "network")) {
        stopped = "failures in a row";
        stopKind = inARow.kind;
        break;
      }
      continue;
    }

    // 2. Match the finished lessons against the course.
    const finished = read.interactions;
    const completedWhopIds = finished
      .map((i) => i.lesson?.id)
      .filter((id): id is string => typeof id === "string");
    const unmatched = completedWhopIds.filter((id) => !lessonByWhopId.has(id));
    const nowMs = Date.now();
    const matched = new Map<string, RowTime>();
    for (const i of finished) {
      const lessonId = i.lesson?.id ? lessonByWhopId.get(i.lesson.id) : undefined;
      if (!lessonId) continue;
      const time = rowTime(i.created_at, nowMs);
      const had = matched.get(lessonId);
      if (!had || betterTime(time, had)) matched.set(lessonId, time);
    }

    // 3. The member's rows: those of the matched lessons decide the plan; all
    //    of them give the pool's latest lesson.
    const isPool = o.group === 0;
    let existing: CompletionRow[] = [];
    if (matched.size > 0 || isPool) {
      const { data, error } = await supabase
        .from("student_lesson_completions")
        .select("id, lesson_id, completed_at, skipped_at")
        .eq("student_id", m.id);
      if (error) {
        if (failMember("lessons_read_failed")) {
          stopped = "failures in a row";
          stopKind = inARow.kind;
          break;
        }
        continue;
      }
      existing = (data ?? []) as CompletionRow[];
    }

    // 4. The plan: a row for a lesson with none, a finish for a row without a time.
    const rowByLesson = new Map(existing.map((r) => [r.lesson_id, r]));
    const toInsert: Array<{ lessonId: string; time: RowTime }> = [];
    const toPromote: Array<{ row: CompletionRow; time: RowTime }> = [];
    for (const [lessonId, time] of matched) {
      const r = rowByLesson.get(lessonId);
      if (!r) toInsert.push({ lessonId, time });
      else if (r.completed_at == null) toPromote.push({ row: r, time });
    }

    // 5. Dry counts; write writes. `added` is the times of the rows the run
    //    adds (dry: would add).
    let added: RowTime[] = [];
    if (!write) {
      added = [...toInsert.map((x) => x.time), ...toPromote.map((x) => x.time)];
      rows.inserted += toInsert.length;
      rows.promoted += toPromote.length;
    } else {
      let writeFailed = false;
      if (toInsert.length > 0) {
        const timeByLesson = new Map(toInsert.map((x) => [x.lessonId, x.time]));
        const { data, error } = await supabase
          .from("student_lesson_completions")
          .upsert(
            toInsert.map((x) => ({ student_id: m.id, lesson_id: x.lessonId, completed_at: x.time.iso })),
            { onConflict: "student_id,lesson_id", ignoreDuplicates: true },
          )
          .select("id, lesson_id, completed_at");
        if (error) {
          writeFailed = true;
        } else {
          // Only the rows the insert added come back; one a login wrote first stays as it was.
          const whopTimed: string[] = [];
          for (const r of (data ?? []) as Array<{ id: string; lesson_id: string; completed_at: string }>) {
            changes.inserted.push([r.id, m.id, r.lesson_id, r.completed_at]);
            rows.inserted += 1;
            const time = timeByLesson.get(r.lesson_id);
            if (time) added.push(time);
            if (time?.source === "whop") whopTimed.push(r.lesson_id);
          }
          // v112: a row added with Whop's own time says so (completed_at_real),
          // so Triple Threat counts it on that day; one given the run's clock
          // does not. Only rows this run added, so the undo, which deletes
          // them, leaves no mark behind. Best-effort: a failure is logged and
          // the rows stand.
          if (whopTimed.length > 0) {
            const { error: markError } = await supabase
              .from("student_lesson_completions")
              .update({ completed_at_real: true })
              .eq("student_id", m.id)
              .in("lesson_id", whopTimed);
            if (markError) {
              console.error(`[whop-catchup] student=${m.id} completed_at_real not written: ${markError.message}`);
            }
          }
        }
      }
      for (const p of writeFailed ? [] : toPromote) {
        const { data, error } = await supabase
          .from("student_lesson_completions")
          .update({ completed_at: p.time.iso, skipped_at: null })
          .eq("id", p.row.id)
          .is("completed_at", null)
          .select("id");
        if (error) {
          writeFailed = true;
          break;
        }
        if ((data ?? []).length > 0) {
          changes.promoted.push([p.row.id, p.row.skipped_at ?? null, p.time.iso]);
          rows.promoted += 1;
          added.push(p.time);
        }
      }
      if (!writeFailed) {
        // The sync row, column for column as the backfill writes it
        // (watch-sync.ts): nothing finished keeps the note when lessons were
        // opened; the token columns are never named.
        const nowIso = new Date().toISOString();
        const sync = finished.length === 0
          ? {
              student_id: m.id,
              last_sync_at: nowIso,
              last_sync_error: read.rawCount === 0 ? null : whopNoneFinishedNote(read.rawCount),
              last_sync_error_at: read.rawCount === 0 ? null : nowIso,
              last_sync_fetched: read.rawCount,
              last_sync_matched: 0,
              last_sync_unmatched: [] as string[],
              updated_at: nowIso,
            }
          : {
              student_id: m.id,
              last_sync_at: nowIso,
              last_sync_error: null,
              last_sync_error_at: null,
              last_sync_fetched: finished.length,
              last_sync_matched: matched.size,
              last_sync_unmatched: unmatched,
              updated_at: nowIso,
            };
        const { error } = await supabase.from("student_whop_sync").upsert(sync, { onConflict: "student_id" });
        if (error) writeFailed = true;
      }
      if (writeFailed) {
        if (failMember("write_failed")) {
          stopped = "failures in a row";
          stopKind = inARow.kind;
          break;
        }
        continue;
      }
    }

    // 6. The streak (call A): a day only for a lesson added now that Whop
    //    says was opened today, UTC, the day tickStudentStreak counts, and
    //    only while the member's streak does not count today yet. A tick on
    //    a counted day changes nothing, so the member is neither counted nor
    //    listed in changes.streak_ticked, whose rows the undo restores from
    //    the snapshot. A streak that cannot be read gets no tick, as
    //    tickStudentStreak itself does after a failed read.
    const today = getTodayUtc();
    if (added.some((t) => t.whopDay === today)) {
      const { data: streakRow, error: streakError } = await supabase
        .from("student_streaks")
        .select("last_streak_date")
        .eq("student_id", m.id)
        .maybeSingle();
      if (streakError) {
        console.error(`[whop-catchup] student=${m.id} streak read failed, no tick: ${streakError.message}`);
      } else if (streakRow?.last_streak_date !== today) {
        streakCount += 1;
        if (write) {
          await tickStudentStreak(supabase, m.id);
          changes.streak_ticked.push(m.id);
        }
      }
    }

    // 7. The counts.
    if (read.rawCount === 0) students.nothing_on_whop += 1;
    else if (finished.length === 0) students.opened_none_finished += 1;
    else students.finished_on_whop += 1;
    if (added.length > 0) students.got_rows += 1;
    else if (matched.size > 0) students.already_all_in_app += 1;
    rows.not_in_course += unmatched.length;
    for (const t of added) {
      if (t.source === "missing") rows.time_missing += 1;
      if (t.source === "later_than_run") rows.time_later_than_run += 1;
      const day = t.iso.slice(0, 10);
      if (earliestDay === null || day < earliestDay) earliestDay = day;
      if (latestDay === null || day > latestDay) latestDay = day;
    }
    if (isPool) {
      // What the next engagement run reads: the latest completed_at, after the run.
      const watchedNow = existing
        .map((r) => (r.completed_at ? Date.parse(r.completed_at) : NaN))
        .filter((t) => Number.isFinite(t));
      const watchedAfter = [...watchedNow, ...added.map((t) => Date.parse(t.iso))];
      if (watchedNow.length === 0) {
        pool.zero_lessons_now += 1;
        if (added.length > 0) pool.of_them_filled += 1;
      }
      if (watchedAfter.length === 0) {
        if (loggedIn.has(m.id)) pool.logged_in_still_zero += 1;
      } else {
        const days = Math.floor((Date.now() - Math.max(...watchedAfter)) / DAY_MS);
        if (days >= 7) pool.last_lesson_7_plus_days += 1;
        else if (days >= 3) pool.last_lesson_3_to_6_days += 1;
      }
    }

    checked += 1;
    cursor = { group: o.group, id: m.id };
    inARow = { kind: null, count: 0 };

    if (finished.length > 0 && matched.size === 0) {
      matchedNoneMembers += 1;
      if (matchedNoneMembers >= MATCHED_NONE_STOP) {
        stopped = "no lesson matched";
        stopKind = "no_lesson_matched";
        break;
      }
    }
  }

  const remaining = ordered.filter((o) => isAfter(o, cursor)).length;
  const poolDone = !ordered.some((o) => o.group === 0 && isAfter(o, cursor));
  const ok = stopKind === null;
  console.info(
    `[whop-catchup] mode=${mode} checked=${checked} remaining=${remaining} stopped=${stopped}` +
      (write ? ` inserted=${rows.inserted} promoted=${rows.promoted}` : ""),
  );

  const answer: Record<string, unknown> = {
    ok,
    mode,
    run_started_at: runStartedAt,
  };
  if (!ok) {
    answer.kind = stopKind;
    answer.error = stopSentence(stopped, stopKind);
  }
  answer.members = { all: ordered.length, pool: ordered.filter((o) => o.group === 0).length };
  answer.this_call = {
    checked,
    remaining,
    next_after: formatCursor(cursor),
    pool_done: poolDone,
    stopped_because: stopped,
    duration_ms: Date.now() - startedAtMs,
  };
  answer.whop = whop;
  answer.database = database;
  const { got_rows, ...studentCounts } = students;
  answer.students = write ? { ...studentCounts, got_rows } : { ...studentCounts, would_get_rows: got_rows };
  const { inserted, promoted, ...rowCounts } = rows;
  answer.rows = {
    ...(write ? { inserted, promoted } : { would_insert: inserted, would_promote: promoted }),
    ...rowCounts,
    earliest_day: earliestDay,
    latest_day: latestDay,
  };
  answer.pool = pool;
  if (write) {
    answer.streak_ticked = streakCount;
    answer.changes = changes;
  } else {
    answer.streak_today = streakCount;
  }
  return answer;
}

/** What an answer with ok: false says, in words a person reads. */
function stopSentence(stopped: CatchupStop, kind: string | null): string {
  if (stopped === "filter ignored") {
    return "Whop sent lesson rows that belong to someone else, so it ignored the member filter. Nothing was written for that member and the run stopped. Tell Claude before running it again.";
  }
  if (stopped === "no lesson matched") {
    return `${MATCHED_NONE_STOP} members with finished Whop lessons matched no lesson of the course, so the run stopped. WHOP_COURSE_ID probably names another course.`;
  }
  const keyLost = kind === "http_401_403" ? " Whop refused the key: it has lost its course permissions." : "";
  return `${SAME_KIND_IN_A_ROW_STOP} members in a row failed with ${kind}, so the run stopped.${keyLost}`;
}

const COMPLETION_COLUMNS = ["id", "student_id", "lesson_id", "completed_at", "skipped_at"];
const SYNC_COLUMNS = [
  "student_id",
  "last_sync_at",
  "last_sync_error",
  "last_sync_error_at",
  "last_sync_fetched",
  "last_sync_matched",
  "last_sync_unmatched",
  "updated_at",
];

/**
 * A failure written on a sync row by the backfill carries the member's Whop id
 * and the course id (whop.ts's message). The snapshot keeps the sentence and
 * hides those, so no answer of the route holds them; the undo never restores
 * a sync row.
 */
function hideWhopIds(text: unknown): unknown {
  if (typeof text !== "string") return text;
  let out = text;
  const course = process.env.WHOP_COURSE_ID?.trim();
  if (course) out = out.split(course).join("[course]");
  return out
    .replace(/\buser_[A-Za-z0-9]{6,}/g, "[whop user]")
    .replace(/[^\s@[\]()<>,;:"']+@[^\s@[\]()<>,;:"']+/g, "[email]");
}

function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const seen: string[] = [];
  for (const r of rows) for (const c of Object.keys(r)) if (!seen.includes(c)) seen.push(c);
  return seen;
}

const compact = (rows: Array<Record<string, unknown>>, columns: string[]) =>
  rows.map((r) => columns.map((c) => r[c] ?? null));

/**
 * {"mode": "snapshot"}: no Whop request. For every member (active or
 * past_due), the columns the write pass can change: their completion rows
 * (never discord_message_link), their sync rows (never the tokens) and every
 * column of their streak rows, as compact arrays under a header. `taken_at`
 * is stamped before the first read, so a row any live writer adds while it
 * reads carries a later time. Throws on a failed read.
 */
export async function takeWhopCatchupSnapshot(
  supabase: SupabaseClient,
  members: CatchupMember[],
): Promise<Record<string, unknown>> {
  const takenAt = new Date().toISOString();
  const ids = members.map((m) => m.id);
  const completions = await readForStudents<Record<string, unknown>>(
    supabase, "student_lesson_completions", COMPLETION_COLUMNS.join(", "), "id", ids,
  );
  const syncRows = await readForStudents<Record<string, unknown>>(
    supabase, "student_whop_sync", SYNC_COLUMNS.join(", "), "student_id", ids,
  );
  const streaks = await readForStudents<Record<string, unknown>>(
    supabase, "student_streaks", "*", "student_id", ids,
  );
  const syncShown = syncRows.map((r) => ({ ...r, last_sync_error: hideWhopIds(r.last_sync_error) }));
  const streakColumns = columnsOf(streaks);
  return {
    ok: true,
    mode: "snapshot",
    taken_at: takenAt,
    counts: {
      members: ids.length,
      student_lesson_completions: completions.length,
      student_whop_sync: syncRows.length,
      student_streaks: streaks.length,
    },
    student_lesson_completions: { columns: COMPLETION_COLUMNS, rows: compact(completions, COMPLETION_COLUMNS) },
    student_whop_sync: { columns: SYNC_COLUMNS, rows: compact(syncShown, SYNC_COLUMNS) },
    student_streaks: { columns: streakColumns, rows: compact(streaks, streakColumns) },
  };
}
