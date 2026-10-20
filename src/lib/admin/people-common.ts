/**
 * What All students, the student page and the Student journey share (admin
 * rebuild 2, D8 and D9): how a read that failed is carried to the page, so
 * it says so instead of drawing an empty list or 0%, and the day and time
 * words every row prints, from one clock: the moment the page was read.
 *
 * No React, no Next, no Supabase client of its own: the readers in
 * students-list.ts, student-detail.ts and journey-board.ts are handed one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** A read that worked, with its rows, or one that failed, with the reason. */
export type Read<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): Read<T> {
  return { ok: true, data };
}

export function failed<T>(error: unknown): Read<T> {
  const text =
    error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return { ok: false, error: text || "The read failed." };
}

/** A Supabase answer as a Read: its error, or its data (`empty` when there is none). */
export function readOf<T>(res: { data: unknown; error: unknown }, empty: T): Read<T> {
  if (res.error) return failed(res.error);
  return ok((res.data ?? empty) as T);
}

const DAY_MS = 86_400_000;

/** A username as the team types it into Discord: without a leading "@" (some rows store one). */
export function bareUsername(name: string | null | undefined): string | null {
  const v = (name ?? "").trim();
  if (!v) return null;
  return v.startsWith("@") ? v.slice(1) : v;
}

/**
 * Day N since a moment, 1 on its first day: getDayNumber's rounding
 * (src/types/database.ts), from `nowMs` instead of the clock, so a list and
 * its rows agree and the dev pages read the same on every run. Null for no
 * date or one that does not parse.
 */
export function dayNumber(fromIso: string | null | undefined, nowMs: number): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(1, Math.ceil((nowMs - t) / DAY_MS));
}

/** "just now", "5 min ago", "3 h ago", "2 days ago": how long ago, from `nowMs`. "Never" for no date. */
export function agoText(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Never";
  const ms = nowMs - t;
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** How many lessons count toward progress (the new course's 140), or a failed read. Never a made-up number: 0 is a failure too. */
export async function readCountingLessons(supabase: SupabaseClient): Promise<Read<number>> {
  const res = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("counts_toward_progress", true);
  if (res.error) return failed(res.error);
  if (typeof res.count !== "number" || res.count <= 0) return failed("No lesson counts toward progress.");
  return ok(res.count);
}
