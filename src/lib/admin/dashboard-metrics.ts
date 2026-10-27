/**
 * The Dashboard's numbers (admin rebuild 2, D3), as plain functions: what
 * each tile counts, from the reads the page makes. No React and no database:
 * src/app/admin/(authenticated)/page.tsx hands in what it read, the dev page
 * /dev/admin/dashboard hands in made-up reads, and
 * client-tests/dashboard.test.mjs runs every rule here as it is.
 *
 * THE TILES
 *   Month 2 conversion  the students who first paid on or after the launch
 *                       (DISCOUNT_LAUNCH_DATE, 9 Oct in Croatia), on the
 *                       monthly plan, whose first renewal has resolved
 *                       (isInMonth2Cohort), and the share of them still
 *                       paying after it (isMonth2Converted). Until the first
 *                       of them resolves, the tile waits and says when the
 *                       first renewals come: never 0%, and never the rate of
 *                       the students from before the launch.
 *   Bounty Program      unchanged: the bounty stamps of the shared population
 *                       per UTC day for 14 days, and all of them. Since the
 *                       owner's review (2026-10-21) also the 14 days before
 *                       them, for the arrow beside the number (bountyTrend).
 *   Open tasks          the database's count of the open tasks the Tasks page
 *                       lists, from admin_config.tasks_reset_at on once the
 *                       tasks reset (v109) has run.
 *   30% needs a hand    the requests the 30% page lists, by its own reads
 *                       (thirty-data.ts readNeedsHand): from 1 October still
 *                       pending or approved 30 minutes after the student
 *                       applied, or with a write_failed as their newest event
 *                       in the last 30 days (the 30% that applies itself,
 *                       T-137, R5; "30% to decide", the pending ones, until
 *                       then).
 *   30% off applied     the database's count of applied requests made from
 *                       DISCOUNT_ELIGIBLE_FROM on: the codes on students' Whop
 *                       memberships (R5), the program's last card.
 *   Active on platform  unchanged: isPayingMember now; the line is the nightly
 *                       snapshot's active_count_cohort.
 *   Canceling           unchanged: isCanceling now; the line is
 *                       canceling_snapshots.
 *   Churned             unchanged: the snapshot's churned_count_cohort per
 *                       day, added up over the 14 days.
 *   Avg progress        ONE metric for the number and the line: the nightly
 *                       snapshot's avg_progress_cohort, as
 *                       rebuild_daily_snapshots writes it (the lessons that
 *                       count, finished by the cohort's members on that day /
 *                       (members x lessons that count) x 100). The number is
 *                       the newest row, so it is the line's last point, and
 *                       the line starts on the course switch's date
 *                       (curriculum_reset_at): the old course's rows (36%)
 *                       never sit beside the new course's.
 *
 * A READ THAT FAILED IS NEVER A NUMBER. Every read arrives as a DashRead: its
 * data, or why it failed. A tile whose read failed is { ok: false, error },
 * and the page says "Couldn't load". Nothing here turns a failure into 0 or
 * into an empty line.
 *
 * Days are UTC dates (YYYY-MM-DD): the dates the two snapshot tables are
 * keyed on, and the days the bounty stamps were always counted in.
 */

import { PAYING_WHOP_PLAN_IDS } from "@/lib/constants";
import {
  isCanceling,
  isInMonth2Cohort,
  isMonth2Converted,
  isPayingMember,
  renewalResolvedMs,
} from "@/lib/admin/metrics-definitions";
import { CURRICULUM_RESET_KEY, resetDateUtc } from "@/lib/curriculum-reset";
import { checkTasksResetAt } from "@/lib/admin/tasks-reset";
import { DISCOUNT_ELIGIBLE_FROM, DISCOUNT_LAUNCH_DATE } from "@/lib/world/discount";

export const DAY_MS = 86_400_000;
/** The trends' window: today (UTC) and the 13 days before it. */
export const TREND_DAYS = 14;

/**
 * The admin_config key the tasks reset writes (admin rebuild 2, D7, migration
 * v109): the moment the old open tasks were archived. The Tasks page lists the
 * tasks created from then on, and so does this count. Before v109 runs there
 * is no row, and every open task counts.
 */
export const TASKS_RESET_KEY = "tasks_reset_at";

/** One read the page made: its data, or why it failed. Never both. */
export type DashRead<T> = { ok: true; data: T } | { ok: false; error: string };

/** One tile: what it shows, or why it cannot. */
export type Tile<T> = { ok: true; value: T } | { ok: false; error: string };

/** One day of a line. `value` is null on a day with no reading: a gap, never 0. */
export interface Point {
  date: string;
  value: number | null;
}

// ── The reads ───────────────────────────────────────────────────────────────

/** A student as the Dashboard reads them: the columns the tiles need, nothing else. */
export interface DashStudent {
  id: string;
  membership_status: string | null;
  whop_plan_id: string | null;
  first_paid_at: string | null;
  canceled_at: string | null;
  cancel_scheduled_at: string | null;
}
export const DASH_STUDENT_COLUMNS =
  "id, membership_status, whop_plan_id, first_paid_at, canceled_at, cancel_scheduled_at";

/**
 * The statuses the Dashboard's students read takes. Active, past due and
 * canceled are the population every tile had before admin rebuild 2;
 * expired is read for Month 2 alone (the review's fix round). Whop can end a
 * membership as expired (mapStatus keeps it), the sync keeps its canceled_at
 * as for a cancel, and Month 2 judges a student by those dates, so leaving
 * expired out took a student who did not renew out of the denominator and
 * pushed the rate up. buildDashboard hands every other tile the rows without
 * it (SHARED_STATUSES), so the Bounty Program's count is unchanged (D3).
 */
export const DASH_STUDENT_STATUSES = ["active", "past_due", "canceled", "expired"] as const;
const SHARED_STATUSES: ReadonlySet<string> = new Set(["active", "past_due", "canceled"]);

/** The students every tile but Month 2 counts: the read without the expired rows. */
export function sharedPopulation(students: DashStudent[]): DashStudent[] {
  return students.filter((s) => SHARED_STATUSES.has(s.membership_status ?? ""));
}

/** A student_milestones row with a bounty stamp. */
export interface BountyStamp {
  student_id: string;
  bounty_access_claimed_at: string | null;
}

/** A daily_progress_snapshots row. Numbers may arrive as strings (numeric columns). */
export interface SnapshotRow {
  snapshot_date: string;
  /** When rebuild_daily_snapshots last wrote the row (it deletes and inserts). */
  created_at: string | null;
  active_count: number | string | null;
  churned_count: number | string | null;
  avg_progress: number | string | null;
  active_count_cohort: number | string | null;
  churned_count_cohort: number | string | null;
  avg_progress_cohort: number | string | null;
}
export const SNAPSHOT_COLUMNS =
  "snapshot_date, created_at, active_count, churned_count, avg_progress, active_count_cohort, churned_count_cohort, avg_progress_cohort";

/** A canceling_snapshots row. */
export interface CancelingRow {
  snapshot_date: string;
  canceling_count_cohort: number | string | null;
}

export interface DashboardReads {
  /**
   * The shared population, as the Dashboard always read it: a Whop membership,
   * active, past due or canceled, on the monthly plan (PAYING_WHOP_PLAN_IDS),
   * first paid on or after ADMIN_STUDENT_JOIN_CUTOFF (25 May).
   */
  students: DashRead<DashStudent[]>;
  /** student_milestones rows with a bounty stamp. */
  bounty: DashRead<BountyStamp[]>;
  /** The open tasks the Tasks page lists, counted by the database. */
  openTasks: DashRead<number>;
  /** admin_config.tasks_reset_at: the floor of that count, null before the reset. */
  tasksResetAt: DashRead<string | null>;
  /** The requests the 30% page lists (readNeedsHand), counted: from 1 October, waiting 30 minutes or more, or a write_failed. */
  needsHand: DashRead<number>;
  /** Applied requests made from DISCOUNT_ELIGIBLE_FROM on, counted by the database. */
  thirtyApplied: DashRead<number>;
  /** The snapshot rows of the 14 days. */
  snapshots: DashRead<SnapshotRow[]>;
  /** The canceling rows of the 14 days. */
  canceling: DashRead<CancelingRow[]>;
  /** admin_config.curriculum_reset_at: the course switch, null before it. */
  resetAt: DashRead<string | null>;
}

type DbError = { message?: string } | null | undefined;

const reason = (e: DbError, fallback: string): string =>
  (e && typeof e.message === "string" && e.message.trim()) || fallback;

/**
 * A read of rows as a DashRead. fetchAllRowsPaginated and fetchAllRowsByKey
 * answer an empty list WITH their error, and supabase-js answers null with
 * it: either way the error wins, so a failed read never looks like no rows.
 */
export function rowsRead<T>(r: { data: T[] | null; error: DbError }): DashRead<T[]> {
  if (r.error) return { ok: false, error: reason(r.error, "the read failed") };
  if (!Array.isArray(r.data)) return { ok: false, error: "no rows came back" };
  return { ok: true, data: r.data };
}

/**
 * A count read (`select(..., { count: "exact", head: true })`) as a DashRead.
 * A count that did not come back is a failure: the old tiles read it as 0,
 * and a failed count looked exactly like "All caught up".
 */
export function countRead(r: { count: number | null | undefined; error: DbError }): DashRead<number> {
  if (r.error) return { ok: false, error: reason(r.error, "the count failed") };
  if (typeof r.count !== "number" || !Number.isFinite(r.count)) {
    return { ok: false, error: "no count came back" };
  }
  return { ok: true, data: r.count };
}

/**
 * A moment as admin_config may hold it: ISO (`2026-10-19T14:33:33.972Z`, as
 * v104 writes the switch) or Postgres's own text for a timestamptz
 * (`2026-10-21 03:12:45.123456+00`). Null for anything else.
 */
export function momentMs(value: string): number | null {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/);
  if (!m) return null;
  const [, date, hm, sec = ":00", frac = "", zone] = m;
  const ms = frac ? `.${frac.slice(1, 4).padEnd(3, "0")}` : "";
  const tz = zone === "Z" ? "Z" : zone.length === 3 ? `${zone}:00` : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const t = Date.parse(`${date}T${hm}${sec}${ms}${tz}`);
  return Number.isFinite(t) ? t : null;
}

/**
 * admin_config's two dates, from one read of both keys. A key with no row is
 * null (no switch yet, no tasks reset yet). A value that is not a date and
 * time with its zone is an error for that key: guessing "no reset" from a
 * broken row would put the archived tasks back in the count.
 *
 * tasks_reset_at goes through checkTasksResetAt (tasks-reset.ts), the check
 * the Tasks page and its insights make, so all three draw the line from the
 * same values and refuse the same ones (Postgres's own text among them: v109
 * writes ISO). curriculum_reset_at keeps momentMs; Avg progress then holds
 * it to curriculum-reset.ts's own format.
 */
export function configReads(r: {
  data: Array<{ key: string; value: string | null }> | null;
  error: DbError;
}): { resetAt: DashRead<string | null>; tasksResetAt: DashRead<string | null> } {
  if (r.error || !Array.isArray(r.data)) {
    const error = `admin_config: ${r.error ? reason(r.error, "the read failed") : "no rows came back"}`;
    return { resetAt: { ok: false, error }, tasksResetAt: { ok: false, error } };
  }
  const rows = r.data;
  const one = (key: string): DashRead<string | null> => {
    const row = rows.find((x) => x.key === key);
    if (!row) return { ok: true, data: null };
    const value = typeof row.value === "string" ? row.value : "";
    if (key === TASKS_RESET_KEY) {
      try {
        return { ok: true, data: checkTasksResetAt(value) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    if (momentMs(value) === null) {
      return { ok: false, error: `admin_config.${key} holds ${JSON.stringify(row.value)}, which is not a date and time` };
    }
    return { ok: true, data: value };
  };
  return { resetAt: one(CURRICULUM_RESET_KEY), tasksResetAt: one(TASKS_RESET_KEY) };
}

// ── Days ────────────────────────────────────────────────────────────────────

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The 14 UTC dates of the trends, oldest first, today last. */
export function trendDays(nowMs: number): string[] {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return Array.from({ length: TREND_DAYS }, (_, i) => utcDate(today - (TREND_DAYS - 1 - i) * DAY_MS));
}

/** The first moment after a UTC date: the next midnight in UTC. */
function dayEndMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) + DAY_MS;
}

const ZAGREB_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zagreb",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date of a moment in Croatia, as YYYY-MM-DD. */
export function croatiaDate(iso: string): string {
  const parts: Record<string, string> = {};
  for (const p of ZAGREB_DATE.formatToParts(new Date(Date.parse(iso)))) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The same day one calendar month later (31 Jan to 28 Feb): a monthly plan's first renewal date. */
export function oneMonthLater(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── Month 2 conversion ──────────────────────────────────────────────────────

const LAUNCH_MS = Date.parse(DISCOUNT_LAUNCH_DATE);

/**
 * First paid on or after the launch. Compared as times: PostgREST writes
 * "+00:00" where the constant writes "Z", and as strings the two sort apart
 * at the very same second.
 */
export function paidSinceLaunch(s: { first_paid_at?: string | null }): boolean {
  if (!s.first_paid_at) return false;
  const t = Date.parse(s.first_paid_at);
  return Number.isFinite(t) && t >= LAUNCH_MS;
}

const onPayingPlan = (s: { whop_plan_id?: string | null }) => PAYING_WHOP_PLAN_IDS.has(s.whop_plan_id ?? "");

/** In Month 2's denominator as of `asOfMs`: paid since the launch, and isInMonth2Cohort (the monthly plan, renewal resolved). */
export function inLaunchMonth2Cohort(s: DashStudent, asOfMs: number): boolean {
  return paidSinceLaunch(s) && isInMonth2Cohort(s, asOfMs);
}

/** In Month 2's numerator as of `asOfMs`: the above, and still paying after the renewal (isMonth2Converted). */
export function launchMonth2Converted(s: DashStudent, asOfMs: number): boolean {
  return paidSinceLaunch(s) && isMonth2Converted(s, asOfMs);
}

export type MonthTwo =
  | {
      kind: "rate";
      /** Still paying after their first renewal. */
      converted: number;
      /** Past their first renewal (renewal and its grace). */
      resolved: number;
      /** converted / resolved, 0 to 1. */
      rate: number;
      /** Per day, in percent: the rate as of the end of that day (today: now). Null on a day nobody had resolved yet. */
      line: Point[];
    }
  | {
      kind: "waiting";
      /** Students on the monthly plan who first paid since the launch. */
      paid: number;
      /** The first of those payments, null when there is none. */
      firstPaidAt: string | null;
      /** The first renewal: one calendar month after that payment (after the launch with none), as a Croatian date. */
      firstRenewalDay: string;
      /** When the first of them resolves and the rate can show; null with no payment yet. */
      firstRateAt: string | null;
    };

/**
 * D3's Month 2 conversion: only the students who first paid on or after the
 * launch. The big number is as of now; each point of the line is as of the end
 * of its day, and today's as of now, so the line ends on the big number.
 */
export function monthTwo(students: DashStudent[], days: string[], nowMs: number): MonthTwo {
  const resolved = students.filter((s) => inLaunchMonth2Cohort(s, nowMs));
  if (resolved.length === 0) {
    const paid = students.filter((s) => paidSinceLaunch(s) && onPayingPlan(s));
    let firstPaidAt: string | null = null;
    let firstMs = Infinity;
    for (const s of paid) {
      const t = Date.parse(s.first_paid_at!);
      if (t < firstMs) {
        firstMs = t;
        firstPaidAt = s.first_paid_at;
      }
    }
    return {
      kind: "waiting",
      paid: paid.length,
      firstPaidAt,
      firstRenewalDay: oneMonthLater(croatiaDate(firstPaidAt ?? DISCOUNT_LAUNCH_DATE)),
      firstRateAt: firstPaidAt ? new Date(renewalResolvedMs(firstPaidAt)).toISOString() : null,
    };
  }
  const converted = resolved.filter((s) => launchMonth2Converted(s, nowMs)).length;
  const line = days.map((date): Point => {
    const asOf = Math.min(dayEndMs(date), nowMs);
    const cohort = students.filter((s) => inLaunchMonth2Cohort(s, asOf));
    if (cohort.length === 0) return { date, value: null };
    const yes = cohort.filter((s) => launchMonth2Converted(s, asOf)).length;
    return { date, value: (yes / cohort.length) * 100 };
  });
  return { kind: "rate", converted, resolved: resolved.length, rate: converted / resolved.length, line };
}

// ── Bounty Program ──────────────────────────────────────────────────────────

export interface Bounty {
  /** Stamps in the 14 days. */
  last14: number;
  /**
   * Stamps in the 14 UTC days before them (the owner's review, 2026-10-21):
   * what the arrow beside the 14-day number compares with (bountyTrend).
   */
  previous14: number;
  /** Every stamp of the population. */
  allTime: number;
  /** Stamps per UTC day. */
  line: Point[];
}

/**
 * Unchanged: the bounty stamps of the students in the shared population, per
 * UTC day, and all of them; with the count of the 14 UTC days before the
 * window, for the arrow.
 */
export function bounty(students: DashStudent[], stamps: BountyStamp[], days: string[]): Bounty {
  const ids = new Set(students.map((s) => s.id));
  const mine = stamps.filter((m) => m.bounty_access_claimed_at && ids.has(m.student_id));
  const perDay = new Map(days.map((d) => [d, 0] as [string, number]));
  // The 14 days before the window: from 14 days before its first day, up to that day.
  const first = days[0] ?? null;
  const before = first ? utcDate(Date.parse(`${first}T00:00:00.000Z`) - TREND_DAYS * DAY_MS) : null;
  let previous14 = 0;
  for (const m of mine) {
    const t = Date.parse(m.bounty_access_claimed_at!);
    if (!Number.isFinite(t)) continue;
    const d = utcDate(t);
    const n = perDay.get(d);
    if (n !== undefined) perDay.set(d, n + 1);
    else if (first && before && d >= before && d < first) previous14 += 1;
  }
  const line = days.map((date) => ({ date, value: perDay.get(date)! }));
  return { last14: line.reduce((sum, p) => sum + (p.value ?? 0), 0), previous14, allTime: mine.length, line };
}

/**
 * The arrow beside the Bounty Program's 14-day number (the owner's review,
 * 2026-10-21): "up" when the last 14 days beat the 14 days before them,
 * "down" when they hold fewer, null (no arrow) when the two are equal.
 */
export function bountyTrend(b: Pick<Bounty, "last14" | "previous14">): "up" | "down" | null {
  if (b.last14 > b.previous14) return "up";
  if (b.last14 < b.previous14) return "down";
  return null;
}

// ── The snapshot tiles ──────────────────────────────────────────────────────

/** A number from a numeric column, or null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The cohort column, or the legacy one where the cohort one is null (rows from before v77). */
function pick(r: SnapshotRow, cohort: keyof SnapshotRow, legacy: keyof SnapshotRow): number | null {
  return num(r[cohort]) ?? num(r[legacy]);
}

/** A line over `days` from rows keyed by date: a day with no row is a gap. */
function lineOf<R extends { snapshot_date: string }>(rows: R[], days: string[], value: (r: R) => number | null): Point[] {
  const byDate = new Map(rows.map((r) => [String(r.snapshot_date).slice(0, 10), r] as [string, R]));
  return days.map((date) => {
    const r = byDate.get(date);
    return { date, value: r ? value(r) : null };
  });
}

export interface WithLine {
  /** The number now, from the students read. */
  count: number;
  /** The line, from its own read: it can fail while the number stands. */
  line: Tile<Point[]>;
}

/** Unchanged: paying members now (isPayingMember); the line is the snapshot's active count. */
export function active(students: DashStudent[], snapshots: DashRead<SnapshotRow[]>, days: string[]): WithLine {
  return {
    count: students.filter((s) => isPayingMember(s)).length,
    line: snapshots.ok
      ? { ok: true, value: lineOf(snapshots.data, days, (r) => pick(r, "active_count_cohort", "active_count")) }
      : { ok: false, error: snapshots.error },
  };
}

/** Unchanged: canceling now (isCanceling); the line is canceling_snapshots. A day with no row is a gap, no longer 0. */
export function canceling(students: DashStudent[], rows: DashRead<CancelingRow[]>, days: string[]): WithLine {
  return {
    count: students.filter((s) => isCanceling(s)).length,
    line: rows.ok
      ? { ok: true, value: lineOf(rows.data, days, (r) => num(r.canceling_count_cohort)) }
      : { ok: false, error: rows.error },
  };
}

export interface Churned {
  /** Access that ended on the days with a reading, added up. */
  total: number;
  /** The days with a reading, of the 14. */
  daysRead: number;
  line: Point[];
}

/** Unchanged: the snapshot's churned count per day, added up over the 14 days (exactly 14: the read once took 15). */
export function churned(rows: SnapshotRow[], days: string[]): Churned {
  const line = lineOf(rows, days, (r) => pick(r, "churned_count_cohort", "churned_count"));
  const read = line.filter((p) => p.value !== null);
  return { total: read.reduce((sum, p) => sum + p.value!, 0), daysRead: read.length, line };
}

export type AvgProgress =
  | {
      kind: "value";
      /** The newest row's avg_progress_cohort: the line's last reading. */
      value: number;
      /** That row's date. */
      date: string;
      /** When that row was written, null when unknown. */
      builtAt: string | null;
      /**
       * The 14 days, as every trend line: the days before the switch's date
       * hold no reading (null), so the line from the switch sits at the right
       * end of the same axis instead of stretching across the tile (the
       * render review's fix round).
       */
      line: Point[];
      /** The switch's date when it falls after the 14 days' first: the line counts from it ("from Mon 19 Oct"). Null otherwise. */
      from: string | null;
    }
  | {
      kind: "none";
      /** The first day the line would show. */
      since: string;
    };

/**
 * D3's Avg progress: the snapshot's avg_progress_cohort for the number and
 * the line alike. The line reads the days from the switch's date on
 * (resetDateUtc, the date the snapshot writers and their trigger use; the
 * rows before it hold the old course), on the 14 days' axis: an earlier day
 * holds no reading. The number is its last reading. Throws when
 * curriculum_reset_at is not a date (resetDateUtc does).
 */
export function avgProgress(rows: SnapshotRow[], days: string[], resetAt: string | null): AvgProgress {
  const floor = resetDateUtc(resetAt);
  const shown = floor ? days.filter((d) => d >= floor) : days;
  const since = shown[0] ?? floor ?? days[0];
  const read = lineOf(rows, days, (r) => pick(r, "avg_progress_cohort", "avg_progress"));
  // Before the switch's date: no reading, never the old course's.
  const line = floor ? read.map((p) => (p.date < floor ? { date: p.date, value: null } : p)) : read;
  const last = [...line].reverse().find((p) => p.value !== null);
  if (!last) return { kind: "none", since };
  const row = rows.find((r) => String(r.snapshot_date).slice(0, 10) === last.date);
  const from = floor && days.length > 0 && floor > days[0] ? since : null;
  return { kind: "value", value: last.value!, date: last.date, builtAt: row?.created_at ?? null, line, from };
}

// ── Change over the window ──────────────────────────────────────────────────

export interface Delta {
  /** Last reading minus first reading. */
  change: number;
  /** The first reading's date. */
  from: string;
}

/** The change from a line's first reading to its last, or null with fewer than two readings. */
export function deltaOf(line: Point[]): Delta | null {
  const read = line.filter((p) => p.value !== null);
  if (read.length < 2) return null;
  const change = read[read.length - 1].value! - read[0].value!;
  return { change: Math.round(change * 10_000) / 10_000, from: read[0].date };
}

// ── The whole page ──────────────────────────────────────────────────────────

export interface DashboardModel {
  /** The moment the numbers were worked out. */
  generatedAt: string;
  /** The 14 UTC dates, oldest first. */
  days: string[];
  monthTwo: Tile<MonthTwo>;
  bounty: Tile<Bounty>;
  openTasks: Tile<{ count: number; since: string | null }>;
  needsHand: Tile<{ count: number; since: string }>;
  thirtyApplied: Tile<{ count: number; since: string }>;
  active: Tile<WithLine>;
  canceling: Tile<WithLine>;
  churned: Tile<Churned>;
  avgProgress: Tile<AvgProgress>;
  /** Every read that failed, named, for the page's one line about them. */
  failed: Array<{ read: string; error: string }>;
}

/** Each read's name on the page's list of failures, in the order listed. */
const READ_NAMES: Record<keyof DashboardReads, string> = {
  students: "Students",
  bounty: "Bounty stamps",
  tasksResetAt: "Admin config",
  resetAt: "Admin config",
  openTasks: "Open tasks",
  needsHand: "30% needs a hand",
  thirtyApplied: "30% off applied",
  snapshots: "Daily snapshots",
  canceling: "Canceling snapshots",
};

/**
 * The failed reads, each once. The two admin_config keys come from one read,
 * and the open tasks are not counted when the tasks reset date could not be
 * read (they carry its error): those collapse into one line. Two other reads
 * that failed alike (two timeouts) stay two lines.
 */
function failedReads(reads: DashboardReads): DashboardModel["failed"] {
  const out: DashboardModel["failed"] = [];
  const settings = new Set<string>();
  for (const key of Object.keys(READ_NAMES) as Array<keyof DashboardReads>) {
    const r = reads[key];
    if (r.ok) continue;
    const shared = key === "tasksResetAt" || key === "resetAt" || key === "openTasks";
    if (shared && settings.has(r.error)) continue;
    if (key === "tasksResetAt" || key === "resetAt") settings.add(r.error);
    out.push({ read: READ_NAMES[key], error: r.error });
  }
  return out;
}

/** Every tile of the page, the numbers the team reads. */
const TILES = ["monthTwo", "bounty", "openTasks", "needsHand", "thirtyApplied", "active", "canceling", "churned", "avgProgress"] as const;

/**
 * No tile could be drawn: the reads every tile needs failed (every read, or
 * the loader threw). The header then says "Couldn't load" (FailedMeta),
 * never "Updated 10:30", which would tell the team the numbers were just
 * read (the render review's second round). With one tile drawn, the header
 * keeps its time and the line at the top says what failed.
 */
export function nothingLoaded(model: Pick<DashboardModel, (typeof TILES)[number]>): boolean {
  return TILES.every((k) => !model[k].ok);
}

/** Every read failed: what the page shows when its loader threw, so no tile is left with a number. */
export function allFailed(error: string): DashboardReads {
  const no = { ok: false as const, error };
  return {
    students: no,
    bounty: no,
    openTasks: no,
    tasksResetAt: no,
    needsHand: no,
    thirtyApplied: no,
    snapshots: no,
    canceling: no,
    resetAt: no,
  };
}

const fail = (error: string) => ({ ok: false as const, error });

/** Every tile from the reads, as of `nowMs`. Pure: the same reads and moment give the same page. */
export function buildDashboard(reads: DashboardReads, nowMs: number): DashboardModel {
  const days = trendDays(nowMs);
  const { students: read, bounty: stamps, snapshots, resetAt } = reads;
  // Month 2 takes every row read; every other tile the population it always had (sharedPopulation).
  const students: DashRead<DashStudent[]> = read.ok ? { ok: true, data: sharedPopulation(read.data) } : read;

  let avg: Tile<AvgProgress>;
  if (!snapshots.ok) avg = fail(snapshots.error);
  else if (!resetAt.ok) avg = fail(resetAt.error);
  else {
    try {
      avg = { ok: true, value: avgProgress(snapshots.data, days, resetAt.data) };
    } catch (e) {
      avg = fail(e instanceof Error ? e.message : String(e));
    }
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    days,
    monthTwo: read.ok ? { ok: true, value: monthTwo(read.data, days, nowMs) } : fail(read.error),
    bounty: !students.ok
      ? fail(students.error)
      : !stamps.ok
        ? fail(stamps.error)
        : { ok: true, value: bounty(students.data, stamps.data, days) },
    openTasks: !reads.tasksResetAt.ok
      ? fail(reads.tasksResetAt.error)
      : !reads.openTasks.ok
        ? fail(reads.openTasks.error)
        : { ok: true, value: { count: reads.openTasks.data, since: reads.tasksResetAt.data } },
    needsHand: reads.needsHand.ok
      ? { ok: true, value: { count: reads.needsHand.data, since: DISCOUNT_ELIGIBLE_FROM } }
      : fail(reads.needsHand.error),
    thirtyApplied: reads.thirtyApplied.ok
      ? { ok: true, value: { count: reads.thirtyApplied.data, since: DISCOUNT_ELIGIBLE_FROM } }
      : fail(reads.thirtyApplied.error),
    active: students.ok ? { ok: true, value: active(students.data, snapshots, days) } : fail(students.error),
    canceling: students.ok ? { ok: true, value: canceling(students.data, reads.canceling, days) } : fail(students.error),
    churned: snapshots.ok ? { ok: true, value: churned(snapshots.data, days) } : fail(snapshots.error),
    avgProgress: avg,
    failed: failedReads(reads),
  };
}

// ── Sync Whop and rebuild ───────────────────────────────────────────────────

export interface RefreshSummary {
  /** ok: every step went through; warn: the route answered, a step inside it failed; err: the route refused or failed. */
  tone: "ok" | "warn" | "err";
  text: string;
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : null;
const stepError = (v: unknown): string | null => {
  const o = asObject(v);
  return o && typeof o.error === "string" && o.error.trim() ? o.error.trim() : null;
};
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The line "Sync Whop and rebuild" shows after POST /api/admin/refresh-everything answers:
 * what each step did, and a step that failed inside a 200 answer named as
 * such (it used to read as a success). `status` 0 is no answer at all.
 */
export function refreshSummary(status: number, body: unknown): RefreshSummary {
  const b = asObject(body);
  if (status < 200 || status >= 300) {
    const said = stepError(b);
    const why = said ?? (status === 0 ? "couldn't reach the server" : `the server answered ${status}`);
    return { tone: "err", text: `Sync failed: ${why}` };
  }
  const parts: string[] = [];
  let tone: RefreshSummary["tone"] = "ok";
  const warn = (text: string) => {
    parts.push(text);
    tone = "warn";
  };

  const sync = asObject(b?.sync);
  const syncError = stepError(b?.sync);
  if (syncError) warn(`Whop sync failed: ${syncError}`);
  else if (sync && typeof sync.fetched === "number") {
    parts.push(`Whop synced, ${Number(sync.inserted ?? 0)} new and ${Number(sync.updated ?? 0)} updated`);
  }

  const rebuild = asObject(b?.rebuild);
  const rebuildError = stepError(b?.rebuild);
  if (rebuildError) warn(`snapshots not rebuilt: ${rebuildError}`);
  else if (rebuild?.ok === true) parts.push("snapshots rebuilt");
  else if (typeof rebuild?.skipped === "string") parts.push("no snapshot to rebuild yet");

  const csm = asObject(b?.csm_tasks);
  const csmError = stepError(b?.csm_tasks);
  if (csmError) warn(`the task check failed: ${csmError}`);
  else if (typeof csm?.tasks_created === "number") parts.push(plural(csm.tasks_created, "new task", "new tasks"));

  const engagement = asObject(b?.engagement);
  const engagementError = stepError(b?.engagement);
  if (engagementError) warn(`the engagement check failed: ${engagementError}`);
  else if (typeof engagement?.alerts === "number") parts.push(plural(engagement.alerts, "alert", "alerts"));

  const naError = stepError(b?.na_tasks);
  if (naError) warn(`the NA task check failed: ${naError}`);

  if (parts.length === 0) return { tone, text: "Synced" };
  const text = parts.join(" · ");
  return { tone, text: text[0].toUpperCase() + text.slice(1) };
}
