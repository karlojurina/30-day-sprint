/**
 * One student, as the student page (/admin/students/[id]) and the journey's
 * drawer show them (admin rebuild 2, D9): what is read, and what is shown.
 *
 * A FAILED READ SAYS SO. The student read failing is the page's error, with
 * Retry (it used to leave a spinner forever), and a student who is not there
 * is "not found". Each other read is kept apart, so a block whose read
 * failed says "Couldn't load", never 0%, 0 days or "No application
 * submitted".
 *
 * THE WHOP SYNC. student_whop_sync keeps its last values through the course
 * switch, so a student not synced since then shows numbers from the old
 * course. The block says "Not synced since the switch" then, by the same
 * rule as the 30% page (whopPulled in src/lib/admin/thirty-view.ts).
 *
 * No plan is read or shown.
 *
 * THE 30% REQUEST is named and coloured by the one map every admin page
 * uses (discount-status.ts): "Applied", "Approved", "Rejected", "Code
 * Applied", as on the 30% page's tabs and the Survey.
 *
 * THE QUICK DMS (quickDms below) are the words of the messages draft of
 * admin rebuild 2 (WI-10, _admin/prds/admin-rebuild-2/messages_v2.md), for
 * the new program: the first name, the program link from admin_config, the
 * area the student is in and the lessons they finished. A part that is not
 * known drops out of its sentence, in words, never a dash.
 *
 *   readStudentDetail   the reads, each one's result kept apart
 *   buildStudentDetail  what the page and the drawer show
 *
 * The course (which one is live, the student's last counted lesson) comes
 * from loadCourseActivity, which the transport reads beside these.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isWhopNoneFinishedNote, progressPercent } from "@/lib/constants";
import { completedLessonIdsFor } from "@/lib/progress";
import { currentStreakAsOf } from "@/lib/streak";
import { activityLabel, type ActivityLabel } from "@/lib/curriculum-reset";
import { discountStatusWords, type DiscountTone } from "@/lib/admin/discount-status";
import { isCanceling } from "@/lib/admin/metrics-definitions";
import { whopPulled } from "@/lib/admin/thirty-view";
import { isDoneOnly } from "@/lib/world/action-items";
import type { CourseActivity } from "@/lib/useJourneyPaceCounts";
import { bareUsername, dayNumber, readOf, type Problem, type Read } from "./people-common";

/** The student's own columns the page needs. Never `*`, and never a plan. */
export const DETAIL_COLUMNS =
  "id, name, email, discord_username, membership_status, first_paid_at, joined_at, last_active_at, cancel_scheduled_at, csm_exempt, ad_submissions_verified";

/**
 * The Whop sync row without its tokens (v75.55): the row also holds the
 * student's Whop login, which is the server's alone, never a browser's.
 */
export const SYNC_COLUMNS =
  "student_id, last_sync_at, last_sync_error, last_sync_error_at, last_sync_unmatched, last_sync_fetched, last_sync_matched";

export interface DetailStudent {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  membership_status: string | null;
  first_paid_at: string | null;
  joined_at: string | null;
  last_active_at: string | null;
  cancel_scheduled_at: string | null;
  csm_exempt: boolean | null;
  ad_submissions_verified: boolean | null;
}

export interface DetailLesson {
  id: string;
  region_id: string;
  title: string | null;
  type: string;
  requires_action: boolean;
  counts_toward_progress: boolean | null;
}

export interface DetailCompletion {
  lesson_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
  skipped_at: string | null;
  discord_message_link: string | null;
}

export interface DetailSync {
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_error_at: string | null;
  last_sync_unmatched: string[] | null;
  last_sync_fetched: number | null;
  last_sync_matched: number | null;
}

export interface StudentDetailReads {
  student: Read<DetailStudent | null>;
  regions: Read<Array<{ id: string; name: string; order_num: number }>>;
  lessons: Read<DetailLesson[]>;
  completions: Read<DetailCompletion[]>;
  discount: Read<{ status: string; promo_code: string | null; created_at: string } | null>;
  streak: Read<{ current_streak: number | null; last_streak_date: string | null } | null>;
  sync: Read<DetailSync | null>;
  /** admin_config.program_login_link, the {programLink} of the messages: the Welcome DM's link. */
  programLink: Read<{ value: string | null } | null>;
}

export async function readStudentDetail(supabase: SupabaseClient, studentId: string): Promise<StudentDetailReads> {
  const [student, regions, lessons, completions, discount, streak, sync, programLink] = await Promise.all([
    supabase.from("students").select(DETAIL_COLUMNS).eq("id", studentId).maybeSingle(),
    supabase.from("regions").select("id, name, order_num").order("order_num"),
    // day is empty on the new course, so sort_order decides there; the old course's days still lead.
    supabase
      .from("lessons")
      .select("id, region_id, title, type, requires_action, counts_toward_progress")
      .order("day")
      .order("sort_order"),
    supabase
      .from("student_lesson_completions")
      .select("lesson_id, completed_at, action_completed_at, skipped_at, discord_message_link")
      .eq("student_id", studentId),
    // The latest request, of any date. No row is no request, not a failure.
    supabase
      .from("discount_requests")
      .select("status, promo_code, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("student_streaks").select("current_streak, last_streak_date").eq("student_id", studentId).maybeSingle(),
    supabase.from("student_whop_sync").select(SYNC_COLUMNS).eq("student_id", studentId).maybeSingle(),
    supabase.from("admin_config").select("value").eq("key", "program_login_link").maybeSingle(),
  ]);
  return {
    student: readOf(student, null),
    regions: readOf(regions, []),
    lessons: readOf(lessons, []),
    completions: readOf(completions, []),
    discount: readOf(discount, null),
    streak: readOf(streak, null),
    sync: readOf(sync, null),
    programLink: readOf(programLink, null),
  };
}

export interface AreaProgress {
  id: string;
  name: string;
  /** Lessons done in the area, of the ones that count toward progress. */
  done: number;
  total: number;
  /** Every lesson of the area, counting or not, in the course's order. */
  lessons: Array<{ id: string; title: string; type: string; done: boolean }>;
}

export type SyncView =
  | { state: "never" }
  | {
      /**
       * "synced": since the switch (any sync while there is none). "stale":
       * not since the switch, so the numbers are the old course's.
       * "unknown": the switch could not be read, so nobody can tell.
       */
      state: "synced" | "stale" | "unknown";
      lastSyncAt: string;
      fetched: number | null;
      matched: number | null;
      unmatched: string[];
      error: { text: string; at: string | null; note: boolean } | null;
    };

export interface StudentDetail {
  id: string;
  /** The name, or the email, or "No name on file". */
  name: string;
  /** students.name as stored, for the quick DMs ("Hey there" without one). */
  nameOnFile: string | null;
  email: string | null;
  username: string | null;
  status: string;
  canceling: boolean;
  firstPaidAt: string | null;
  joinedAt: string | null;
  lastActiveAt: string | null;
  /** Day N since the first payment (joined_at when there is none, as before). */
  day: number | null;
  csmExempt: boolean;
  adVerified: boolean;
  /** After the switch, how recently a counted lesson was finished. Null before it or when unknown. */
  activity: ActivityLabel | null;
  /** The furthest area with a finished lesson, by the course's order (the first area when none). Null when unknown. */
  areaName: string | null;
  progress: Read<number>;
  /** Lessons that count toward progress, finished. */
  lessonsDone: Read<number>;
  streak: Read<number>;
  areas: Read<AreaProgress[]>;
  /**
   * Every action item of the course with what the drawer says of it
   * (actionItemStatus): "Handed in" with its Discord link, or "Done" for one
   * with nothing to post (isDoneOnly, DONE_ONLY_ACTION_ITEMS in
   * action-items.ts), whose link is always null; "Not yet" until the action is
   * done. On a lesson with a video the word is the action's, whether or not
   * the video is watched, for both kinds.
   */
  actionItems: Read<Array<{ id: string; title: string; shipped: boolean; status: ActionItemStatus; link: string | null }>>;
  discount: Read<{ status: string; text: string; tone: DiscountTone; code: string | null; askedAt: string } | null>;
  sync: Read<SyncView>;
  /** The program link the Welcome DM sends, or null when it is not set or could not be read (the sentence then has no link). */
  programLink: string | null;
  /** Which course is live could not be read: what that means for the page, and the read's own words. */
  courseProblem: Problem | null;
  generatedAt: string;
}

/** What the journey's drawer says of an action item. */
export type ActionItemStatus = "Handed in" | "Done" | "Not yet";

/**
 * "Handed in" for an action item done with its Discord link, "Done" for one
 * done with nothing to post (isDoneOnly), "Not yet" for either before it is.
 */
export function actionItemStatus(shipped: boolean, doneOnly: boolean): ActionItemStatus {
  if (!shipped) return "Not yet";
  return doneOnly ? "Done" : "Handed in";
}

/** The first of `reads` that failed, or null when every one worked. */
function firstFailure(...reads: Read<unknown>[]): { ok: false; error: string } | null {
  for (const r of reads) if (!r.ok) return r;
  return null;
}

/** Lessons done over the lessons that count, from one student's rows (lesson_is_complete's rule, progress.ts). */
function areasOf(
  regions: Array<{ id: string; name: string; order_num: number }>,
  lessons: DetailLesson[],
  done: Set<string>,
): AreaProgress[] {
  return regions.map((r) => {
    const mine = lessons.filter((l) => l.region_id === r.id);
    const counting = mine.filter((l) => l.counts_toward_progress !== false);
    return {
      id: r.id,
      name: r.name,
      done: counting.filter((l) => done.has(l.id)).length,
      total: counting.length,
      lessons: mine.map((l) => ({ id: l.id, title: l.title?.trim() || l.id, type: l.type, done: done.has(l.id) })),
    };
  });
}

/**
 * What the page and the drawer show. Hand it reads whose `student` worked
 * and found the student (the transport turns the other two cases into the
 * page's error and "not found"). `nowIso` is the moment of the read.
 */
export function buildStudentDetail(
  reads: StudentDetailReads & { student: { ok: true; data: DetailStudent } },
  course: CourseActivity,
  nowIso: string,
): StudentDetail {
  const nowMs = Date.parse(nowIso);
  const s = reads.student.data;
  const lessons = reads.lessons.ok ? reads.lessons.data : [];
  const completions = reads.completions.ok ? reads.completions.data : [];
  const lessonsFailed = firstFailure(reads.lessons, reads.completions);
  const done = lessonsFailed ? new Set<string>() : completedLessonIdsFor(completions, lessons);
  const counting = lessons.filter((l) => l.counts_toward_progress !== false);

  const progress: Read<number> =
    lessonsFailed ??
    (counting.length === 0
      ? { ok: false, error: "No lesson counts toward progress." }
      : { ok: true, data: progressPercent(counting.filter((l) => done.has(l.id)).length, counting.length) });
  const lessonsDone: Read<number> = lessonsFailed ?? { ok: true, data: counting.filter((l) => done.has(l.id)).length };

  const areas: Read<AreaProgress[]> = firstFailure(reads.regions, reads.lessons, reads.completions) ?? {
    ok: true,
    data: areasOf(reads.regions.ok ? reads.regions.data : [], lessons, done),
  };

  // The furthest area with a finished lesson that counts, in the course's
  // order, the first one when there is none: the journey's chip by the same
  // rule (student_current_region, v98).
  let areaName: string | null = null;
  if (areas.ok && areas.data.length > 0) {
    const reached = areas.data.filter((a) => a.done > 0);
    areaName = (reached.at(-1) ?? areas.data[0]).name;
  }

  const actionItems: StudentDetail["actionItems"] = lessonsFailed ?? {
    ok: true,
    data: lessons
      .filter((l) => l.requires_action || l.type === "action")
      .map((l) => {
        const c = completions.find((x) => x.lesson_id === l.id);
        const shipped = Boolean(c?.action_completed_at) || Boolean(c?.completed_at && l.type === "action");
        // A Done-only action item has nothing posted: no link is shown, even one saved before it was on the list.
        const doneOnly = isDoneOnly(l.id);
        return {
          id: l.id,
          title: l.title?.trim() || l.id,
          shipped,
          status: actionItemStatus(shipped, doneOnly),
          link: doneOnly ? null : (c?.discord_message_link ?? null),
        };
      }),
  };

  let sync: Read<SyncView>;
  if (!reads.sync.ok) sync = reads.sync;
  else if (!reads.sync.data?.last_sync_at) sync = { ok: true, data: { state: "never" } };
  else {
    const row = reads.sync.data;
    const lastSyncAt = row.last_sync_at as string;
    const errorText = row.last_sync_error?.trim() || null;
    sync = {
      ok: true,
      data: {
        // The same rule as the 30% page's "Whop progress not pulled yet".
        state: !course.ok ? "unknown" : whopPulled(lastSyncAt, course.resetAt) ? "synced" : "stale",
        lastSyncAt,
        fetched: row.last_sync_fetched,
        matched: row.last_sync_matched,
        unmatched: row.last_sync_unmatched ?? [],
        error: errorText
          ? // Lessons opened on Whop and none finished: the backfill's note, not a failure (constants.ts).
            { text: errorText, at: row.last_sync_error_at, note: isWhopNoneFinishedNote(errorText) }
          : null,
      },
    };
  }

  const discount: StudentDetail["discount"] = !reads.discount.ok
    ? reads.discount
    : {
        ok: true,
        data: reads.discount.data
          ? {
              status: reads.discount.data.status,
              text: discountStatusWords(reads.discount.data.status).label,
              tone: discountStatusWords(reads.discount.data.status).tone,
              code: reads.discount.data.promo_code,
              askedAt: reads.discount.data.created_at,
            }
          : null,
      };
  const link = reads.programLink.ok ? (reads.programLink.data?.value ?? "").trim() : "";

  const streak: Read<number> = reads.streak.ok
    ? { ok: true, data: currentStreakAsOf(reads.streak.data, nowIso.slice(0, 10)) }
    : reads.streak;

  return {
    id: s.id,
    name: s.name?.trim() || s.email?.trim() || "No name on file",
    nameOnFile: s.name,
    email: s.email,
    username: bareUsername(s.discord_username),
    status: s.membership_status ?? "",
    canceling: isCanceling(s),
    firstPaidAt: s.first_paid_at,
    joinedAt: s.joined_at,
    lastActiveAt: s.last_active_at,
    day: dayNumber(s.first_paid_at ?? s.joined_at, nowMs),
    csmExempt: s.csm_exempt === true,
    adVerified: s.ad_submissions_verified === true,
    activity: course.ok && course.resetAt != null ? activityLabel(course.lastByStudent.get(s.id) ?? null, nowMs) : null,
    areaName: course.ok && course.resetAt != null ? areaName : null,
    progress,
    lessonsDone,
    streak,
    areas,
    actionItems,
    discount,
    sync,
    programLink: link || null,
    courseProblem: course.ok ? null : { text: "Couldn't read which course is live, so no activity is shown.", error: course.error },
    generatedAt: nowIso,
  };
}

/** "Mike" from "Mike Smith"; "there" with no name on file, as the templates greet. */
export function dmFirstName(nameOnFile: string | null | undefined): string {
  return (nameOnFile ?? "").trim().split(/\s+/)[0] || "there";
}

/**
 * The three quick DMs of the student page, in the messages draft's words
 * (admin rebuild 2, WI-10). Each part that is not known leaves its sentence
 * out, in words: no link, no area, or no count of lessons. No em dash, no
 * "unlock", no old brand, numbers in digits.
 */
export function quickDms(
  s: Pick<StudentDetail, "nameOnFile" | "programLink" | "areaName" | "lessonsDone">,
): Array<{ label: string; text: string }> {
  const name = dmFirstName(s.nameOnFile);
  const signIn = s.programLink
    ? `Sign in with your Whop account here: ${s.programLink} and start with the first lesson on the map.`
    : "Sign in with your Whop account and start with the first lesson on the map.";
  const where = s.areaName ? ` I can see you're in ${s.areaName} now.` : "";
  const done = s.lessonsDone.ok ? s.lessonsDone.data : null;
  const finished =
    done == null || done === 0
      ? "Saw you're working through the lessons, nice 💪"
      : `Saw you've finished ${done} ${done === 1 ? "lesson" : "lessons"} so far, nice 💪`;
  return [
    {
      label: "Welcome",
      text: `Hey ${name}! Welcome to Ecom University 🙌 Have you opened the app yet? ${signIn} Let me know if you have any questions!`,
    },
    {
      label: "Check-in",
      text: `Hey ${name}! Just checking in, how's the course going?${where} Anything I can help with?`,
    },
    {
      label: "Encouragement",
      text: `Hey ${name}! ${finished} When you hit an action item, do it even if it feels scary. That's where things actually click.`,
    },
  ];
}
