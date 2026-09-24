/**
 * Who may see /world before it is finished.
 *
 * WHY THIS IS NEEDED RIGHT NOW. The preview deployment cannot be used at all:
 * NEXT_PUBLIC_APP_URL drives both the Whop OAuth redirect_uri
 * (api/auth/whop/authorize:14) and every post-login redirect
 * (callback:468 -> `${appUrl}/auth/complete`), and it points at production. So
 * logging in on a preview lands you on production, every time. The only
 * surface where this can actually be looked at is production itself — which
 * means /world has to be able to exist there without students finding it.
 *
 * WHAT THIS IS AND IS NOT. It is a UX gate, not a security boundary, and it
 * should not be mistaken for one:
 *   * The route renders client-side, so a determined person can see the shell
 *     before the redirect fires.
 *   * What /world shows — area names and lesson titles — is the same catalog
 *     /dashboard already shows that student.
 *   * The things that ARE sensitive stay gated server-side and are untouched:
 *     video URLs need an active membership (video-token), completions need the
 *     telemetry to back them (lesson-watched), and every table is behind RLS.
 * Its job is to stop 845 students stumbling into a half-built UI, nothing more.
 *
 * CLOSED BY DEFAULT. An unset or empty variable admits nobody, so forgetting to
 * configure it hides the world rather than exposing it. At cutover the gate is
 * deleted outright, not opened.
 *
 * Student UUIDs in a NEXT_PUBLIC bundle are deliberate and safe: every student
 * already holds their own id client-side, and holding someone else's grants
 * nothing, because every policy keys on auth.uid() rather than on a submitted
 * id.
 */

function parseIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const WORLD_PREVIEW_IDS = parseIds(
  process.env.NEXT_PUBLIC_WORLD_PREVIEW_IDS,
);

/** True when /world is open to everyone — set only at cutover. */
export const WORLD_IS_LIVE = process.env.NEXT_PUBLIC_WORLD_LIVE === "true";

/**
 * The rule itself, with its inputs passed in so it can be tested without
 * reaching into process.env. The "closed by default" property is the one that
 * matters, and a property you cannot test is one you are hoping for.
 */
export function isAllowed(
  studentId: string | null | undefined,
  allowIds: string[],
  isLive: boolean,
): boolean {
  if (isLive) return true;
  if (!studentId) return false;
  return allowIds.includes(studentId);
}

export function canSeeWorld(studentId: string | null | undefined): boolean {
  return isAllowed(studentId, WORLD_PREVIEW_IDS, WORLD_IS_LIVE);
}

/** Where to send everyone else. Becomes '/world' at cutover. */
export const STUDENT_HOME =
  process.env.NEXT_PUBLIC_STUDENT_HOME?.trim() || "/dashboard";
