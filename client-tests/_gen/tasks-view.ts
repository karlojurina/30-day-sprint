/**
 * The Tasks page's rules (admin rebuild 2, D7 and D12), apart from React, so
 * client-tests/admin-people.test.mjs runs them as they are.
 *
 *   TasksAnswer       what GET /api/admin/tasks answers
 *   tabsFor           the tabs: To do, Sent, Dismissed, and Archived once the reset ran
 *   openTiers         To do in priority tiers, canceling first, oldest first in each
 *   historyGroups     Sent and Dismissed by when they were closed: today, this week, older
 *   closedLine        what a closed task says about how it was closed
 *   waitingText       how long an open task has waited
 *   queueHealth       the "am I done for today" line
 *   insightsRanges    the insights page's two ranges, the second named for the reset
 *
 * Every clock here is the moment the list was read (the answer's
 * generatedAt), so a row and the list agree and the dev page reads the same
 * on every run.
 */

import { BUCKET_PRIORITY } from "./templates.ts";
import { isCanceling } from "./metrics-definitions.ts";
import { dayLabel } from "./croatia-dates.ts";
import type { DmLinks } from "./tasks-reset.ts";

export type TaskStatus = "open" | "completed" | "dismissed";
export type TaskTab = TaskStatus | "archived";

/** The student columns a task row uses (the route joins the whole row). */
export interface TaskStudent {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  membership_status: string | null;
  first_paid_at: string | null;
  joined_at: string;
  cancel_scheduled_at: string | null;
}

export interface TaskTemplate {
  scenario_id: string;
  bucket: string | null;
  week: string | null;
  title: string | null;
  body: string;
  is_admin_only: boolean | null;
}

export interface TaskRow {
  id: string;
  student_id: string;
  scenario_id: string;
  status: TaskStatus;
  behavior_summary: string | null;
  created_at: string;
  completed_at: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  notes: string | null;
  outcome?: "replied" | "no_reply" | null;
  student: TaskStudent | null;
  template: TaskTemplate | null;
}

/** GET /api/admin/tasks?status=all (src/app/api/admin/tasks/route.ts). */
export interface TasksAnswer {
  tasks: TaskRow[];
  archived: TaskRow[];
  counts: Record<TaskTab, number>;
  resetAt: string | null;
  links: DmLinks;
  generatedAt: string;
}

export const TAB_LABEL: Record<TaskTab, string> = {
  open: "To do",
  completed: "Sent",
  dismissed: "Dismissed",
  archived: "Archived",
};

/** The tabs with their counts. Archived only once the reset ran: before it nothing is older than it. */
export function tabsFor(answer: Pick<TasksAnswer, "counts" | "resetAt">): Array<{ value: TaskTab; label: string; count: number }> {
  const tabs: TaskTab[] = answer.resetAt ? ["open", "completed", "dismissed", "archived"] : ["open", "completed", "dismissed"];
  return tabs.map((t) => ({ value: t, label: TAB_LABEL[t], count: answer.counts[t] ?? 0 }));
}

export type Tier = "canceling" | "cancel_path" | "at_risk" | "other";

export const TIER_ORDER: Tier[] = ["canceling", "cancel_path", "at_risk", "other"];

export const TIER_LABEL: Record<Tier, string> = {
  canceling: "Canceling: save first",
  cancel_path: "Cancel path",
  at_risk: "At risk",
  other: "Events and wins",
};

/** Canceling comes from the student (they clicked cancel and still have access), not the template, so any open task of theirs goes first. */
export function tierOf(row: TaskRow): Tier {
  if (row.student && isCanceling(row.student)) return "canceling";
  const b = row.template?.bucket;
  if (b === "cancel_path") return "cancel_path";
  if (b === "at_risk") return "at_risk";
  return "other";
}

/** To do in tiers, oldest first in each; inside "Events and wins" the buckets' own order first. */
export function openTiers(rows: TaskRow[]): Record<Tier, TaskRow[]> {
  const tiers: Record<Tier, TaskRow[]> = { canceling: [], cancel_path: [], at_risk: [], other: [] };
  for (const r of rows) if (r.status === "open") tiers[tierOf(r)].push(r);
  for (const tier of TIER_ORDER) {
    tiers[tier].sort((a, b) => {
      if (tier === "other") {
        const pa = BUCKET_PRIORITY[a.template?.bucket ?? ""] ?? 99;
        const pb = BUCKET_PRIORITY[b.template?.bucket ?? ""] ?? 99;
        if (pa !== pb) return pa - pb;
      }
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    });
  }
  return tiers;
}

/** When a task left To do: sent, dismissed, or (still open, on Archived) when it was made. */
export function closedAt(row: TaskRow): string {
  if (row.status === "completed") return row.completed_at ?? row.created_at;
  if (row.status === "dismissed") return row.dismissed_at ?? row.created_at;
  return row.created_at;
}

export type HistoryGroup = "today" | "this_week" | "older";

export const HISTORY_LABEL: Record<HistoryGroup, string> = { today: "Today", this_week: "This week", older: "Older" };

/** Sent or Dismissed, newest first, in three groups by when each was closed. */
export function historyGroups(rows: TaskRow[], status: "completed" | "dismissed", nowIso: string): Record<HistoryGroup, TaskRow[]> {
  const nowMs = Date.parse(nowIso);
  const groups: Record<HistoryGroup, TaskRow[]> = { today: [], this_week: [], older: [] };
  const mine = rows.filter((r) => r.status === status).sort((a, b) => Date.parse(closedAt(b)) - Date.parse(closedAt(a)));
  for (const r of mine) {
    const days = (nowMs - Date.parse(closedAt(r))) / 86_400_000;
    groups[days < 1 ? "today" : days < 7 ? "this_week" : "older"].push(r);
  }
  return groups;
}

/** The reset's own words in a note: the page says it in plain words instead. */
const RESET_NOTE = /\s*\[reset for the new program\]\s*$/;

/**
 * How a closed task was closed, for its row: "Sent Tue 20 Oct", "Dismissed
 * Mon 19 Oct: Already replied in Discord", "Dismissed Tue 20 Oct by the
 * reset for the new program". An archived task still open says when it was
 * made. Dates in Croatia (croatia-dates.ts).
 */
export function closedLine(row: TaskRow): string {
  if (row.status === "completed") {
    const outcome = row.outcome === "replied" ? ", replied" : row.outcome === "no_reply" ? ", no reply" : "";
    return `Sent ${dayLabel(row.completed_at ?? row.created_at)}${outcome}`;
  }
  if (row.status === "dismissed") {
    const day = dayLabel(row.dismissed_at ?? row.created_at);
    const note = (row.notes ?? "").trim();
    if (RESET_NOTE.test(note)) {
      const before = note.replace(RESET_NOTE, "").trim();
      return `Dismissed ${day} by the reset for the new program${before ? `. Before it: ${before}` : ""}`;
    }
    if (!row.dismissed_by && note) return `Dismissed ${day} automatically: ${note}`;
    return note ? `Dismissed ${day}: ${note}` : `Dismissed ${day}`;
  }
  return `Made ${dayLabel(row.created_at)}, still open`;
}

/** "waiting 3 h", "waiting 2 days": how long an open task has been on To do, and how loud to say it (2 days warn, 4 urgent). */
export function waitingText(createdAt: string, nowIso: string): { text: string; level: "calm" | "warn" | "urgent" } {
  const ms = Math.max(0, Date.parse(nowIso) - Date.parse(createdAt));
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return { text: `waiting ${Math.max(1, Math.floor(ms / 3_600_000))} h`, level: "calm" };
  return { text: `waiting ${days} ${days === 1 ? "day" : "days"}`, level: days >= 4 ? "urgent" : days >= 2 ? "warn" : "calm" };
}

/** Open by tier, the oldest wait in days, and how many were sent today (in Croatia). */
export function queueHealth(rows: TaskRow[], nowIso: string) {
  const open = rows.filter((r) => r.status === "open");
  const nowMs = Date.parse(nowIso);
  let oldestDays = 0;
  for (const r of open) oldestDays = Math.max(oldestDays, Math.floor((nowMs - Date.parse(r.created_at)) / 86_400_000));
  const today = dayLabel(nowIso);
  return {
    open: open.length,
    canceling: open.filter((r) => tierOf(r) === "canceling").length,
    cancelPath: open.filter((r) => tierOf(r) === "cancel_path").length,
    atRisk: open.filter((r) => tierOf(r) === "at_risk").length,
    oldestDays,
    sentToday: rows.filter((r) => r.status === "completed" && r.completed_at && dayLabel(r.completed_at) === today).length,
  };
}

/** What the student's name shows as. */
export function taskStudentName(row: TaskRow): string {
  return row.student?.name?.trim() || row.student?.email?.trim() || "No name on file";
}

export type InsightsRange = "30d" | "all";

/**
 * The insights page's two ranges. Once the reset ran, "all" covers only the
 * tasks made since it (the route counts nothing older), so it says so.
 */
export function insightsRanges(resetAt: string | null): Array<{ value: InsightsRange; label: string }> {
  return [
    { value: "30d", label: "Last 30 days" },
    { value: "all", label: resetAt ? `Since the reset, ${dayLabel(resetAt)}` : "All time" },
  ];
}
