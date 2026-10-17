import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The closed doors before the new course (T-078).
 *
 * Lovro, 2026-10-16: until the new version is released on Monday 19 October,
 * students see "We are updating to the new course. It will be released soon."
 * instead of the login and the dashboard, and the team's admin keeps working.
 *
 * TWO VERCEL VALUES, BOTH READ ONLY ON THE SERVER.
 *   STUDENT_APP_CLOSED    "true" closes the student app. Anything else, or
 *                         nothing, leaves it open exactly as before.
 *   STUDENT_APP_OPEN_FOR  Whop user ids (user_...), comma-separated: the
 *                         accounts that go through every closed door, so a
 *                         test account can walk the app. It never reaches
 *                         the browser.
 * There is no NEXT_PUBLIC_ twin, because the browser never needs the raw
 * value: the login page is decided on the server (app/login/layout.tsx), and a
 * signed-in student's pages by /api/auth/me, which answers for that student
 * only (appClosed: true, or nothing).
 *
 * THE DOORS. Each one asks this file and nothing else:
 *   - app/login/layout.tsx: the login is the coming-soon page, no sign-in button.
 *   - the Whop callback: refuses before it writes anything (whopLoginMayProceed).
 *   - /api/auth/me and StudentGuard: a student who already holds a session sees
 *     the coming-soon page, and nothing under the guard mounts.
 *   - every student API route: refuses right after its token check, before any
 *     read or write (refuseWhileClosed).
 *   - the Field Journal page, for a student's own journal.
 *   - the tab title and link preview of every page that can show the
 *     coming-soon page (comingSoonMetadata): the login, the dashboard, the
 *     dashboard mockup and the Field Journal.
 *
 * THE TEAM IS OUTSIDE IT. Team members sign in with email and password at
 * /admin/login, an account separate from any Whop login, and nothing on that
 * path asks this file: /admin, /api/admin/*, /api/auth/team, the crons, the
 * webhooks and the team's discount routes (approve, reject, mark-applied). The
 * one door a team member could meet is the Whop login, if a team_members row
 * ever pointed at a Whop account; whopLoginMayProceed lets that one through.
 *
 * Every check reads the environment when it runs, never at module load, so a
 * test can set the values case by case. Vercel applies a changed value only on
 * the next deploy, so a page built at deploy time and the routes agree.
 */

/** Lovro's two sentences (2026-10-16), word for word. */
export const COMING_SOON_MESSAGE =
  "We are updating to the new course. It will be released soon.";

/** The smaller line under them: lessons finished on Whop count in the new app. */
export const COMING_SOON_WHOP_LINE =
  "Keep watching the course on Whop in the meantime.";

/** The code a refused route sends beside the message. */
export const STUDENT_APP_CLOSED_CODE = "student_app_closed";

/** "true", in any case and with spaces around it, closes the app. */
export function isClosedValue(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

/** Comma-separated Whop user ids, with spaces and empty entries dropped. */
export function parseWhopIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The rule, with its inputs passed in. Open: everyone. Closed: the team, and
 * a Whop id on the list, matched exactly. Nobody else, a missing id included.
 */
export function mayEnter(input: {
  closed: boolean;
  whopUserId: string | null | undefined;
  openFor: readonly string[];
  isTeam?: boolean;
}): boolean {
  if (!input.closed) return true;
  if (input.isTeam) return true;
  if (!input.whopUserId) return false;
  return input.openFor.includes(input.whopUserId);
}

/** Whether the student app is closed on this deploy. */
export function studentAppClosed(): boolean {
  return isClosedValue(process.env.STUDENT_APP_CLOSED);
}

/**
 * The tab title and link preview of a page that can show the coming-soon
 * page, for its generateMetadata. Closed: "Ecom University" and Lovro's
 * sentence, so the browser tab, a bookmark and a link pasted into Discord read
 * the new name. It can't know who is looking, so a listed test account sees
 * the same title. Open: nothing, so the root layout's own title and
 * description stand exactly as before.
 */
export function comingSoonMetadata(): Metadata {
  if (!studentAppClosed()) return {};
  return { title: "Ecom University", description: COMING_SOON_MESSAGE };
}

function openForList(): string[] {
  return parseWhopIds(process.env.STUDENT_APP_OPEN_FOR);
}

/** Whether a student with this Whop id gets through the closed doors now. */
export function studentMayEnter(whopUserId: string | null | undefined): boolean {
  return mayEnter({
    closed: studentAppClosed(),
    whopUserId,
    openFor: openForList(),
  });
}

/**
 * Whether the student signed in as this Supabase user gets through now. Open:
 * true, with no database read. Closed: reads the student's Whop id only when
 * the list names someone, and a failed read keeps the door shut.
 */
export async function studentMayEnterAs(
  supabase: SupabaseClient,
  supabaseUserId: string,
): Promise<boolean> {
  if (!studentAppClosed()) return true;
  const openFor = openForList();
  if (openFor.length === 0) return false;
  try {
    const { data, error } = await supabase
      .from("students")
      .select("whop_user_id")
      .eq("supabase_user_id", supabaseUserId)
      .maybeSingle();
    return !error && mayEnter({ closed: true, whopUserId: data?.whop_user_id, openFor });
  } catch {
    // A read that throws is a read that failed.
    return false;
  }
}

/**
 * For a student API route, right after its token check. Null: carry on exactly
 * as before (the app is open, or this student is on the list). A Response:
 * return it, a 503 with Lovro's words. A 503 says "closed for now"; a 403
 * would read as "membership not active" to the map's video player.
 */
export async function refuseWhileClosed(
  supabase: SupabaseClient,
  supabaseUserId: string,
): Promise<Response | null> {
  if (await studentMayEnterAs(supabase, supabaseUserId)) return null;
  return Response.json(
    { error: COMING_SOON_MESSAGE, code: STUDENT_APP_CLOSED_CODE },
    { status: 503 },
  );
}

/**
 * For the Whop login, once Whop has said who this is and before anything is
 * written. True: carry on as before. Open: true, with no database read.
 * Closed: true for a Whop id on the list, and for a Whop account that a
 * team_members row points at. No code creates such a row (team members sign
 * in at /admin/login), but if one exists the closed doors must not lock that
 * person out. Any failed read: false.
 */
export async function whopLoginMayProceed(
  supabase: SupabaseClient,
  whopUserId: string,
): Promise<boolean> {
  if (!studentAppClosed()) return true;
  if (mayEnter({ closed: true, whopUserId, openFor: openForList() })) return true;
  try {
    const { data: student, error } = await supabase
      .from("students")
      .select("supabase_user_id")
      .eq("whop_user_id", whopUserId)
      .maybeSingle();
    if (error || !student?.supabase_user_id) return false;
    const { data: team, error: teamError } = await supabase
      .from("team_members")
      .select("id")
      .eq("id", student.supabase_user_id)
      .maybeSingle();
    return mayEnter({
      closed: true,
      whopUserId,
      openFor: [],
      isTeam: !teamError && !!team,
    });
  } catch {
    return false;
  }
}
