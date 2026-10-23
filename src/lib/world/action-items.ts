/**
 * Action items: the Discord link a student pastes, and the button that
 * completes the action. One set of rules for every place that touches them:
 * the old dashboard's form (src/components/map/LessonSheet.tsx), the new
 * lesson page (src/components/world/ActionItemBlock.tsx), the two routes
 * (/api/student/save-action-link, /api/student/mark-action-shipped) and the
 * development page's pretend student (src/app/dev/world-app).
 *
 * No imports, so client-tests/action-items.test.mjs runs this very file.
 *
 * THE LINK. A Discord message link and nothing else: server id, channel id,
 * message id, an optional trailing slash. A message inside a thread has the
 * same shape (the thread's id sits where the channel's would). The thread's
 * own link has two ids and is refused, as the old app refused it and as the
 * database's CHECK constraint (migration v28, discord_message_link_format_chk)
 * refuses it. The pattern and the message below are the old route's, word for
 * word. An empty link means "clear it".
 *
 * THE TWO HALVES. A completion row holds `completed_at` (the video was
 * watched, or the lesson was finished) and `action_completed_at` (the action
 * was done). src/lib/progress.ts: an action item is complete when both are
 * set. An action item that is a video lesson gets the first half from the
 * video, and the button records the second. An action item with no video
 * half (a setup lesson of the new course) has only the button, so the button
 * records both. The old catalog has no such lesson (every action item there
 * is a watch lesson since migration v74), and the routes only take the second
 * reading on the new course's catalog, so the live app writes exactly what it
 * wrote before.
 *
 * DONE WITH NO LINK (the owner, 2026-10-22). Some action items have nothing
 * to post: the student does them and sends nothing to a coach. The four of
 * AI Ads + Content (study the winning AI ads, choose a visual style, step
 * away and think, take a piece of content apart) and three of Static Ads (The
 * Backbone, Imitation, the Brand Deck). Their block is a Done button and no
 * link field, and the button writes what the complete button writes: on a
 * lesson with no video both halves, so Done finishes it; on one with a video
 * (The Backbone, Imitation) the action half alone, and the lesson is done
 * once its video is watched too, in either order, as an action item with a
 * link is. Done never writes the video's half. mark-action-shipped completes
 * them with no link saved, and the admin drawer says Done and shows no link.
 * Every other action item still needs its link: Static Ads' Static Ad Brief,
 * which the coaches review, Video Ads I's two, and Video Ads II's four editing
 * breakdowns (a4l02 to a4l05, action items since 2026-10-23 by migration v114,
 * with no change here). DONE_ONLY_ACTION_ITEMS below is the one list.
 *
 * FINISHED ON WHOP. A lesson finished on Whop counts in the app as one
 * finished in the app (the owner's standing rule). A Done-only action item has
 * nothing to hand in, so finishing it on Whop finishes it: the three writers
 * that bring Whop's finished lessons in (the webhook, the backfill a login or
 * a visit runs, the team's catch-up) give its row the action half with the
 * watch half where the row has none, and the backfill and the catch-up also
 * fill the action half of a row a Whop writer left with the watch half alone
 * before the item was on the list. An action half already on the row (Done
 * pressed before the video was watched) is kept. The watch half still comes
 * only from what Whop reports for that lesson, as for every lesson.
 * isLessonComplete and the database's progress view are unchanged: the row
 * has both halves. The other seven still need their link and their button.
 */

/**
 * The action items finished with Done alone, by lesson id, in
 * supabase/catalog/course_catalog.json: three of Static Ads (a5l08 The
 * Backbone and a5l12 Imitation, each with a video, and a5l22 the Brand Deck,
 * a setup lesson) and the four of AI Ads + Content (a6l03, a6l10, a6l17,
 * a6l19, setup lessons). The list lives here, beside the rules that read it,
 * so it ships with the code: a column in the catalog would need a migration
 * pasted by hand and code that works before and after the paste. The ids are
 * the course's own (the old course's run from l001 to l078, so none of them
 * is one of these), and client-tests/done-only.test.mjs fails when the
 * catalog no longer has these seven as those action items, or when a3l17,
 * a3l25, a4l02 to a4l05 and a5l23 (the Static Ad Brief) stop being the
 * course's other seven.
 */
export const DONE_ONLY_ACTION_ITEMS: ReadonlySet<string> = new Set([
  "a5l08",
  "a5l12",
  "a5l22",
  "a6l03",
  "a6l10",
  "a6l17",
  "a6l19",
]);

/** Is this action item finished with Done alone, with no Discord link? */
export function isDoneOnly(lessonId: string | null | undefined): boolean {
  return typeof lessonId === "string" && DONE_ONLY_ACTION_ITEMS.has(lessonId);
}

/**
 * The time the backfill and the catch-up give the action half of a Done-only
 * action item they find finished on Whop: Whop's own time for the lesson (the
 * interaction's created_at, when the student opened it there, the time the
 * catch-up already writes as the lesson's finish), or the row's completed_at
 * when Whop gives none that reads as a time, or one later than `nowMs`.
 *
 * Never the moment of the write. Triple Threat reads action_completed_at as
 * the moment an action item was finished (finishedAt in achievement-rules.ts).
 * A login or visit sync stamps completed_at with its own time and marks it as
 * no real finish, so its rows count on no day; an action half at the sync's
 * time would count every Done-only action item that sync brings in on the
 * sync's day. At Whop's time, which is before the sync's completed_at, the
 * row counts on no day, as every other row of that sync. On a row whose
 * completed_at is a real finish (the webhook's, the catch-up's with Whop's
 * time) it counts on that day. When Whop gives no usable time the action half
 * is the row's own completed_at, and the row then counts on that day.
 */
export function whopActionTime(whopTime: string | null | undefined, completedAt: string, nowMs: number): string {
  const t = typeof whopTime === "string" ? Date.parse(whopTime) : NaN;
  return Number.isFinite(t) && t <= nowMs ? new Date(t).toISOString() : completedAt;
}

/** The old route's pattern, unchanged. Also the database's CHECK constraint (v28). */
export const DISCORD_MESSAGE_LINK_RE =
  /^https:\/\/discord\.com\/channels\/[0-9]+\/[0-9]+\/[0-9]+\/?$/;

/** The old route's message for a link of any other shape, unchanged. */
export const DISCORD_LINK_ERROR =
  'That doesn\'t look like a Discord message link. Right-click the message in #ad-review and click "Copy Message Link."';

/**
 * Said when there is no link yet: by the lesson page when Save is pressed with
 * nothing in the field, and by mark-action-shipped when the new course's
 * complete button arrives with no link saved (never for a Done-only action
 * item). One sentence for both.
 */
export const PASTE_LINK_FIRST = "Paste the link to your Discord message first.";

export type DiscordLinkCheck =
  | { ok: true; link: string | null }
  | { ok: false; error: string };

/**
 * What a pasted value means. Spaces around it are dropped; nothing (or only
 * spaces, or a value that is not a string) is `null`, which clears a saved
 * link; a Discord message link is kept as typed; anything else is refused
 * with the old app's message.
 */
export function checkDiscordLink(raw: unknown): DiscordLinkCheck {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) return { ok: true, link: null };
  if (!DISCORD_MESSAGE_LINK_RE.test(trimmed)) return { ok: false, error: DISCORD_LINK_ERROR };
  return { ok: true, link: trimmed };
}

/** The two fields of a lesson these rules read. */
export interface ActionLesson {
  type: string;
  requires_action: boolean | null | undefined;
}

/** May this lesson carry a Discord link? save-action-link's rule, unchanged. */
export function takesDiscordLink(lesson: ActionLesson | null | undefined): boolean {
  return !!lesson && (lesson.requires_action === true || lesson.type === "action");
}

/** Does this lesson have an action half to complete? mark-action-shipped's rule, unchanged. */
export function hasActionHalf(lesson: ActionLesson | null | undefined): boolean {
  return !!lesson && lesson.requires_action === true;
}

/**
 * Is the lesson's other half (`completed_at`) recorded apart from the button?
 * Yes for a video lesson: watching records it. No for an action item with no
 * video half on the new course's catalog: the button records it too. On the
 * old catalog always yes, which is how the route behaved before.
 */
export function watchHalfIsSeparate(lesson: ActionLesson, catalogIsV2: boolean): boolean {
  return !catalogIsV2 || lesson.type === "watch";
}

/** The two halves of a completion row. */
export interface CompletionHalves {
  completed_at: string | null;
  action_completed_at: string | null;
}

/** What the complete button (or undoing it) does to the student's row for that lesson. */
export type ActionWrite =
  | { kind: "none" }
  | { kind: "insert"; fields: CompletionHalves }
  | { kind: "update"; fields: Partial<CompletionHalves> }
  | { kind: "delete" };

/**
 * The write for marking the action done (`shipped`) or undone.
 *
 * With the watch half separate it is mark-action-shipped's logic as it was:
 * the action half is set or cleared, a new row carries the action half only,
 * and undoing on a row whose video was never watched deletes the row.
 *
 * With no separate watch half, done sets both halves (an earlier
 * `completed_at` is kept) and undone clears both and keeps the row, so a
 * saved link survives.
 */
export function actionWrite({
  separateWatchHalf,
  shipped,
  existing,
  now,
}: {
  separateWatchHalf: boolean;
  shipped: boolean;
  existing: CompletionHalves | null;
  now: string;
}): ActionWrite {
  const actionAt = shipped ? now : null;
  if (separateWatchHalf) {
    if (!existing) {
      return shipped ? { kind: "insert", fields: { completed_at: null, action_completed_at: now } } : { kind: "none" };
    }
    if (!shipped && !existing.completed_at) return { kind: "delete" };
    return { kind: "update", fields: { action_completed_at: actionAt } };
  }
  if (!existing) {
    return shipped ? { kind: "insert", fields: { completed_at: now, action_completed_at: now } } : { kind: "none" };
  }
  return {
    kind: "update",
    fields: shipped
      ? { completed_at: existing.completed_at ?? now, action_completed_at: now }
      : { completed_at: null, action_completed_at: null },
  };
}

/** The row's two halves after `write`: null when there is no row. */
export function applyActionWrite(
  existing: CompletionHalves | null,
  write: ActionWrite,
): CompletionHalves | null {
  switch (write.kind) {
    case "none":
      return existing;
    case "delete":
      return null;
    case "insert":
      return { ...write.fields };
    case "update":
      return existing ? { ...existing, ...write.fields } : null;
  }
}

/**
 * Said when the write failed because the lesson is not in the table the
 * completions point at. Before the cutover `student_lesson_completions`
 * references `lessons(id)` only, so on a deployment reading the new course's
 * staging catalog every write for its lessons fails this way. Nothing was
 * written, and the student is told so.
 */
export const LESSON_NOT_SAVABLE_YET =
  "This lesson can't be saved yet, so nothing was recorded. Please tell the team.";

/**
 * The plain words for a failed write, when there are some: a foreign key
 * violation (Postgres 23503) is the lesson missing from `lessons`. Any other
 * failure returns null and the route answers it as it did before.
 */
export function plainWriteError(error: { code?: string | null } | null | undefined): string | null {
  return error?.code === "23503" ? LESSON_NOT_SAVABLE_YET : null;
}

/** The lesson page's block, in one of three states (an error is shown on top of any of them). */
export type ActionItemState = "empty" | "saved" | "completed";

export interface ActionItemView {
  state: ActionItemState;
  /** The saved link, or null. Always null on a Done-only action item. */
  link: string | null;
  /**
   * The complete button can be pressed: a link is saved and the action is not
   * done. The old app's rule (LessonSheet, canShip): the link first, and the
   * video does not have to be watched first. A Done-only action item needs no
   * link: its Done button can be pressed until the action is done.
   */
  canComplete: boolean;
  /** When the action was done, or null. */
  completedAt: string | null;
  /** The action is done and the lesson is not: its video is still to be watched. */
  waitingOnVideo: boolean;
}

/**
 * The block's state from the student's row for the lesson (null when there is
 * none). `separateWatchHalf`: whether the lesson's other half comes from
 * watching (watchHalfIsSeparate). `doneOnly`: the action item is finished with
 * Done alone (isDoneOnly), so a link on its row (one saved before the item was
 * on the list) is never read: it is "empty" until Done, then "completed",
 * never "saved". On one with a video, Done pressed before the video is watched
 * leaves it waiting on the video, as the other kind's button does.
 */
export function actionItemView(
  row: (CompletionHalves & { discord_message_link?: string | null }) | null | undefined,
  separateWatchHalf: boolean,
  doneOnly = false,
): ActionItemView {
  const link = !doneOnly && row?.discord_message_link && row.discord_message_link.length > 0 ? row.discord_message_link : null;
  const completedAt = row?.action_completed_at ?? null;
  return {
    state: completedAt ? "completed" : link ? "saved" : "empty",
    link,
    canComplete: !completedAt && (doneOnly || link !== null),
    completedAt,
    waitingOnVideo: completedAt !== null && separateWatchHalf && !row?.completed_at,
  };
}
