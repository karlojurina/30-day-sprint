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
 */

/** The old route's pattern, unchanged. Also the database's CHECK constraint (v28). */
export const DISCORD_MESSAGE_LINK_RE =
  /^https:\/\/discord\.com\/channels\/[0-9]+\/[0-9]+\/[0-9]+\/?$/;

/** The old route's message for a link of any other shape, unchanged. */
export const DISCORD_LINK_ERROR =
  'That doesn\'t look like a Discord message link. Right-click the message in #ad-review and click "Copy Message Link."';

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
  /** The saved link, or null. */
  link: string | null;
  /**
   * The complete button can be pressed: a link is saved and the action is not
   * done. The old app's rule (LessonSheet, canShip): the link first, and the
   * video does not have to be watched first.
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
 * watching (watchHalfIsSeparate).
 */
export function actionItemView(
  row: (CompletionHalves & { discord_message_link?: string | null }) | null | undefined,
  separateWatchHalf: boolean,
): ActionItemView {
  const link = row?.discord_message_link && row.discord_message_link.length > 0 ? row.discord_message_link : null;
  const completedAt = row?.action_completed_at ?? null;
  return {
    state: completedAt ? "completed" : link ? "saved" : "empty",
    link,
    canComplete: !completedAt && link !== null,
    completedAt,
    waitingOnVideo: completedAt !== null && separateWatchHalf && !row?.completed_at,
  };
}
